'use client';

import { useId, useMemo, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useI18n, useT } from '@/i18n/client';
import type { AttributeField } from '@/lib/industries';
import type { FeedMapping, FeedTarget } from '@/lib/real-estate/portals/feed/mapping';
import type { FlatValue } from '@/lib/real-estate/portals/feed/parse';
import { cn } from '@/lib/utils';
import type { Preview } from './types';

const selectCls =
  'h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring';

const GENERAL: FeedTarget[] = ['name', 'description', 'price', 'currency', 'images', 'category', 'tags', 'is_active'];
const IDENT: FeedTarget[] = ['external_id', 'external_url'];

/** Human label for a mapping target. */
export function useTargetLabel(fields: AttributeField[]) {
  const t = useT();
  const { locale } = useI18n();
  return (target: string) => {
    if (target.startsWith('attr:')) {
      const f = fields.find((x) => x.key === target.slice(5));
      return f ? f.label[locale === 'en' ? 'en' : 'es'] : target.slice(5);
    }
    return t(`portals.targets.${target}`);
  };
}

const show = (v: FlatValue | undefined) => (v === undefined ? '' : Array.isArray(v) ? `${v[0]} (+${v.length - 1})` : v);

export function MappingEditor({
  preview,
  mapping,
  fields,
  onChange,
}: {
  preview: Preview;
  mapping: FeedMapping;
  fields: AttributeField[];
  onChange: (m: FeedMapping) => void;
}) {
  const t = useT();
  const id = useId();
  const label = useTargetLabel(fields);
  const used = useMemo(() => new Set(Object.values(mapping).filter(Boolean)), [mapping]);
  const sample = (path: string) => show(preview.samples.find((s) => s[path] !== undefined)?.[path]);

  const option = (target: FeedTarget, current: FeedTarget | undefined) => (
    <option key={target} value={target} disabled={used.has(target) && current !== target && target !== 'images' && target !== 'tags'}>
      {label(target)}
    </option>
  );

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">{t('portals.mapping.intro', { count: preview.total, fields: preview.fields.length })}</p>
      {!used.has('external_id') && (
        <p role="alert" className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
          <AlertTriangle className="size-4 shrink-0" aria-hidden /> {t('portals.mapping.needId')}
        </p>
      )}
      <div className="max-h-[380px] overflow-auto rounded-md border">
        <table className="w-full text-sm">
          <caption className="sr-only">{t('portals.mapping.caption')}</caption>
          <thead className="sticky top-0 bg-muted text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2 font-semibold">{t('portals.mapping.field')}</th>
              <th scope="col" className="px-3 py-2 font-semibold">{t('portals.mapping.sample')}</th>
              <th scope="col" className="w-56 px-3 py-2 font-semibold">{t('portals.mapping.target')}</th>
            </tr>
          </thead>
          <tbody>
            {preview.fields.map((path, i) => {
              const current = mapping[path];
              const selectId = `${id}-m-${i}`;
              return (
                <tr key={path} className={cn('border-t', current && 'bg-emerald-500/5')}>
                  <td className="px-3 py-1.5 font-mono text-xs break-all">
                    <label htmlFor={selectId}>{path}</label>
                  </td>
                  <td className="max-w-[260px] truncate px-3 py-1.5 text-xs text-muted-foreground" title={sample(path)}>
                    {sample(path)}
                  </td>
                  <td className="px-3 py-1.5">
                    <select
                      id={selectId}
                      className={selectCls}
                      value={current ?? ''}
                      onChange={(e) => {
                        const next = { ...mapping };
                        if (e.target.value) next[path] = e.target.value as FeedTarget;
                        else delete next[path];
                        onChange(next);
                      }}
                    >
                      <option value="">{t('portals.mapping.ignore')}</option>
                      <optgroup label={t('portals.mapping.groupId')}>{IDENT.map((x) => option(x, current))}</optgroup>
                      <optgroup label={t('portals.mapping.groupGeneral')}>{GENERAL.map((x) => option(x, current))}</optgroup>
                      <optgroup label={t('portals.mapping.groupAttributes')}>
                        {fields.map((f) => option(`attr:${f.key}` as FeedTarget, current))}
                      </optgroup>
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function PlanSummary({ preview, fields }: { preview: Preview; fields: AttributeField[] }) {
  const t = useT();
  const label = useTargetLabel(fields);
  const [onlyErrors, setOnlyErrors] = useState(true);
  const p = preview.plan;
  const rows = p.rows.filter((r) => !onlyErrors || r.action === 'error');
  return (
    <div className="space-y-2" aria-live="polite">
      <p className="text-sm">
        {t('portals.preview.summary', { total: preview.total, creates: p.creates, updates: p.updates, errors: p.errors + p.without_id })}
      </p>
      {p.missing > 0 && <p className="text-sm text-muted-foreground">{t('portals.preview.missing', { count: p.missing })}</p>}
      {p.foreign_currency > 0 && <p className="text-sm text-muted-foreground">{t('portals.preview.foreign', { count: p.foreign_currency })}</p>}
      {p.without_id > 0 && <p className="text-sm text-amber-700 dark:text-amber-300">{t('portals.preview.withoutId', { count: p.without_id })}</p>}
      {p.rows.length > 0 && (
        <>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={onlyErrors} onChange={(e) => setOnlyErrors(e.target.checked)} className="size-4 accent-emerald-600" />
            {t('portals.preview.onlyErrors')}
          </label>
          <div className="max-h-[260px] overflow-auto rounded-md border">
            <table className="w-full text-sm">
              <caption className="sr-only">{t('portals.preview.caption')}</caption>
              <thead className="sticky top-0 bg-muted text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-2">{t('portals.preview.ref')}</th>
                  <th scope="col" className="px-3 py-2">{t('portals.preview.name')}</th>
                  <th scope="col" className="px-3 py-2">{t('portals.preview.action')}</th>
                  <th scope="col" className="px-3 py-2">{t('portals.preview.issues')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-3 text-center text-muted-foreground">{t('portals.preview.noErrors')}</td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr key={`${r.row}-${r.ref}`} className="border-t">
                      <td className="px-3 py-1.5 font-mono text-xs">{r.ref || `#${r.row}`}</td>
                      <td className="px-3 py-1.5">{r.name || '—'}</td>
                      <td className="px-3 py-1.5">{t(`portals.preview.${r.action}`)}</td>
                      <td className="px-3 py-1.5 text-xs text-red-700 dark:text-red-300">
                        {r.errors.map((e) => `${label(e.field)}: ${t(`portals.errors.${e.code}`)}`).join(' · ')}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

'use client';

import { useState } from 'react';
import { useI18n, useT } from '@/i18n/client';
import { useWorkspace } from '@/hooks/use-workspace';
import { formatMoney } from '@/lib/workspace/countries';
import type { ImportPlan, ImportTarget, PlannedRow } from '@/lib/catalog/import';
import { Badge } from '@/components/ui/badge';

// Rows rendered at once; the counts above always cover the whole file.
const MAX_VISIBLE = 500;

interface Props {
  plan: ImportPlan;
  targetLabel: (target: ImportTarget) => string;
}

export function ImportPreview({ plan, targetLabel }: Props) {
  const t = useT();
  const { locale } = useI18n();
  const { workspace } = useWorkspace();
  const [onlyErrors, setOnlyErrors] = useState(false);

  const moneyLocale = workspace?.country && /^[A-Z]{2}$/.test(workspace.country) ? `${locale}-${workspace.country}` : locale;
  const rows = onlyErrors ? plan.rows.filter((r) => r.action === 'error') : plan.rows;

  const price = (r: PlannedRow) => {
    if (r.data.price === undefined) return '';
    if (r.data.price === null) return t('catalogImport.preview.noPrice');
    return workspace ? formatMoney(r.data.price, workspace.currency, moneyLocale) : String(r.data.price);
  };

  const status = (r: PlannedRow) =>
    r.action === 'error' ? (
      <Badge variant="destructive">{t('catalogImport.preview.error')}</Badge>
    ) : r.action === 'update' ? (
      <Badge variant="secondary">{t('catalogImport.preview.update')}</Badge>
    ) : (
      <Badge variant="outline">{t('catalogImport.preview.create')}</Badge>
    );

  return (
    <div className="grid gap-3">
      <p className="text-sm" aria-live="polite">
        {t('catalogImport.preview.summary', {
          total: plan.rows.length,
          creates: plan.creates,
          updates: plan.updates,
          errors: plan.errors,
        })}
      </p>
      <p className="text-xs text-muted-foreground">{t('catalogImport.preview.updateNote')}</p>
      {plan.errors > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-destructive">{t('catalogImport.preview.skipNote')}</p>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-primary" checked={onlyErrors} onChange={(e) => setOnlyErrors(e.target.checked)} />
            {t('catalogImport.preview.onlyErrors')}
          </label>
        </div>
      )}
      {plan.creates + plan.updates === 0 && <p className="text-sm text-destructive">{t('catalogImport.preview.nothing')}</p>}
      <div className="max-h-[50vh] overflow-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted text-left text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="px-2 py-2 font-medium">{t('catalogImport.preview.row')}</th>
              <th scope="col" className="px-2 py-2 font-medium">{t('catalogImport.preview.status')}</th>
              <th scope="col" className="px-2 py-2 font-medium">{t('catalogImport.preview.name')}</th>
              <th scope="col" className="px-2 py-2 font-medium">{t('catalogImport.preview.sku')}</th>
              <th scope="col" className="px-2 py-2 text-right font-medium">{t('catalogImport.preview.price')}</th>
              <th scope="col" className="px-2 py-2 font-medium">{t('catalogImport.preview.category')}</th>
              <th scope="col" className="px-2 py-2 font-medium">{t('catalogImport.preview.issues')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.slice(0, MAX_VISIBLE).map((r) => (
              <tr key={r.row} className={r.action === 'error' ? 'bg-destructive/5' : undefined}>
                <td className="px-2 py-1.5 tabular-nums text-muted-foreground">{r.row}</td>
                <td className="px-2 py-1.5">{status(r)}</td>
                <td className="max-w-[14rem] truncate px-2 py-1.5 font-medium" title={r.data.name}>
                  {r.data.name || '—'}
                </td>
                <td className="px-2 py-1.5 text-muted-foreground">{r.data.sku ?? ''}</td>
                <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{price(r)}</td>
                <td className="px-2 py-1.5 text-muted-foreground">{r.data.category ?? ''}</td>
                <td className="px-2 py-1.5 text-xs text-destructive">
                  {r.errors.map((e) => `${targetLabel(e.field as ImportTarget)}: ${t(`catalogImport.errors.${e.code}`)}`).join(' · ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > MAX_VISIBLE && (
        <p className="text-xs text-muted-foreground">
          {MAX_VISIBLE} / {rows.length}
        </p>
      )}
    </div>
  );
}

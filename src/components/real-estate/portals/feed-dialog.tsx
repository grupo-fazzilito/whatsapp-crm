'use client';

import { useId, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, RefreshCw, Search } from 'lucide-react';
import { useT } from '@/i18n/client';
import { useWorkspace } from '@/hooks/use-workspace';
import { productAttributesFor } from '@/lib/catalog/attributes';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { MappingEditor, PlanSummary } from './mapping-editor';
import { usePreview } from './use-preview';
import { PORTAL_NAMES, type Feed, type PortalName } from './types';
import { apiErrorText } from './errors';

const selectCls =
  'h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring';

interface Form {
  name: string;
  portal: PortalName;
  url: string;
  format: Feed['format'];
  schedule: Feed['schedule'];
  deactivate_missing: boolean;
}

const EMPTY: Form = { name: '', portal: 'urbania', url: '', format: 'auto', schedule: 'daily', deactivate_missing: true };

/** Create / edit an agency feed: URL → analyze → field mapping → save (and optionally import now). Remount (key) per opening. */
export function FeedDialog({
  open,
  feed,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  feed: Feed | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (feed: Feed, runNow: boolean) => void;
}) {
  const t = useT();
  const id = useId();
  const { workspace } = useWorkspace();
  const fields = useMemo(() => (workspace ? productAttributesFor(workspace.industry, workspace.settings) : []), [workspace]);
  // The parent remounts this dialog (key) every time it opens, so the
  // initial state below is always fresh.
  const [form, setForm] = useState<Form>(() =>
    feed ? { name: feed.name, portal: feed.portal, url: feed.url, format: feed.format, schedule: feed.schedule, deactivate_missing: feed.deactivate_missing } : EMPTY,
  );
  const [saving, setSaving] = useState(false);
  const pv = usePreview();

  const analyze = async (withMapping: boolean) => {
    await pv.run(
      { url: form.url, format: form.format },
      {
        item_path: pv.preview?.item_path ?? feed?.item_path ?? null,
        feed_id: feed?.id,
        deactivate_missing: form.deactivate_missing,
        mapping: withMapping ? pv.mapping : feed && !pv.preview ? feed.mapping : undefined,
      },
    );
  };

  const save = async (runNow: boolean) => {
    if (!pv.preview) return;
    setSaving(true);
    const body = { ...form, item_path: pv.preview.item_path || null, mapping: pv.mapping };
    const res = await fetch(feed ? `/api/real-estate/portals/feeds/${feed.id}` : '/api/real-estate/portals/feeds', {
      method: feed ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      toast.error(apiErrorText(t, data.error));
      return;
    }
    toast.success(t('portals.feeds.saved'));
    onSaved(data.feed as Feed, runNow);
    onOpenChange(false);
  };

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const canAnalyze = /^https?:\/\/\S+$/.test(form.url.trim()) && !pv.loading;
  const hasId = Object.values(pv.mapping).includes('external_id');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{feed ? t('portals.feeds.editTitle') : t('portals.feeds.newTitle')}</DialogTitle>
          <DialogDescription>{t('portals.feeds.dialogHelp')}</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label htmlFor={`${id}-name`} className="text-sm font-medium">{t('portals.feeds.name')}</label>
            <Input id={`${id}-name`} value={form.name} maxLength={120} onChange={(e) => set('name', e.target.value)} placeholder={t('portals.feeds.namePlaceholder')} />
          </div>
          <div className="space-y-1">
            <label htmlFor={`${id}-portal`} className="text-sm font-medium">{t('portals.feeds.portal')}</label>
            <select id={`${id}-portal`} className={selectCls} value={form.portal} onChange={(e) => set('portal', e.target.value as PortalName)}>
              {PORTAL_NAMES.map((p) => (
                <option key={p} value={p}>{t(`portals.portalNames.${p}`)}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1 sm:col-span-2">
            <label htmlFor={`${id}-url`} className="text-sm font-medium">{t('portals.feeds.url')}</label>
            <Input id={`${id}-url`} type="url" inputMode="url" value={form.url} onChange={(e) => set('url', e.target.value)} placeholder="https://mi-crm.com/export/propiedades.xml" aria-describedby={`${id}-url-help`} />
            <p id={`${id}-url-help`} className="text-xs text-muted-foreground">{t('portals.feeds.urlHelp')}</p>
          </div>
          <div className="space-y-1">
            <label htmlFor={`${id}-format`} className="text-sm font-medium">{t('portals.feeds.format')}</label>
            <select id={`${id}-format`} className={selectCls} value={form.format} onChange={(e) => set('format', e.target.value as Form['format'])}>
              {(['auto', 'xml', 'json', 'csv'] as const).map((f) => (
                <option key={f} value={f}>{t(`portals.formats.${f}`)}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label htmlFor={`${id}-schedule`} className="text-sm font-medium">{t('portals.feeds.schedule')}</label>
            <select id={`${id}-schedule`} className={selectCls} value={form.schedule} onChange={(e) => set('schedule', e.target.value as Form['schedule'])}>
              <option value="daily">{t('portals.feeds.daily')}</option>
              <option value="manual">{t('portals.feeds.manual')}</option>
            </select>
          </div>
          <label className="flex items-start gap-2 text-sm sm:col-span-2">
            <input type="checkbox" className="mt-0.5 size-4 accent-emerald-600" checked={form.deactivate_missing} onChange={(e) => set('deactivate_missing', e.target.checked)} />
            <span>{t('portals.feeds.deactivateMissing')}</span>
          </label>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => analyze(false)} disabled={!canAnalyze}>
            {pv.loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Search className="size-4" aria-hidden />}
            {pv.preview ? t('portals.feeds.reanalyze') : t('portals.feeds.analyze')}
          </Button>
          {pv.preview && (
            <Button type="button" variant="ghost" onClick={() => analyze(true)} disabled={pv.loading}>
              <RefreshCw className="size-4" aria-hidden /> {t('portals.mapping.recalculate')}
            </Button>
          )}
        </div>
        {pv.error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{apiErrorText(t, pv.error)}</p>}

        {pv.preview && (
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              {t('portals.feeds.detected', { format: pv.preview.format.toUpperCase(), path: pv.preview.item_path || '—' })}
            </p>
            <MappingEditor preview={pv.preview} mapping={pv.mapping} fields={fields} onChange={pv.setMapping} />
            <PlanSummary preview={pv.preview} fields={fields} />
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button type="button" variant="outline" onClick={() => save(false)} disabled={!pv.preview || !hasId || !form.name.trim() || saving}>
            {t('portals.feeds.save')}
          </Button>
          <Button type="button" onClick={() => save(true)} disabled={!pv.preview || !hasId || !form.name.trim() || saving}>
            {saving && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {t('portals.feeds.saveAndRun')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

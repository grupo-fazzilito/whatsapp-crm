'use client';

import { useId, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Download, FileUp, Loader2, RefreshCw, Upload } from 'lucide-react';
import { useT } from '@/i18n/client';
import { useWorkspace } from '@/hooks/use-workspace';
import { productAttributesFor } from '@/lib/catalog/attributes';
import { matrixToRecords } from '@/lib/real-estate/portals/feed/parse';
import { readMatrix } from '@/components/catalog/import/spreadsheet';
import { Button } from '@/components/ui/button';
import { MappingEditor, PlanSummary } from './mapping-editor';
import { usePreview } from './use-preview';
import { downloadPortalTemplate } from './template';
import { apiErrorText } from './errors';
import { PORTAL_NAMES, type PortalName, type SourceBody } from './types';

const MAX_BYTES = 15 * 1024 * 1024;
const selectCls =
  'h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** One-off import of a file the agency exported (XML / JSON / CSV / Excel). */
export function FileImport({ onImported }: { onImported: () => void }) {
  const t = useT();
  const id = useId();
  const { workspace } = useWorkspace();
  const fields = useMemo(() => (workspace ? productAttributesFor(workspace.industry, workspace.settings) : []), [workspace]);
  const [portal, setPortal] = useState<PortalName>('urbania');
  const [deactivate, setDeactivate] = useState(false);
  const [source, setSource] = useState<SourceBody | null>(null);
  const [fileName, setFileName] = useState('');
  const [reading, setReading] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const pv = usePreview();

  const readFile = async (file: File) => {
    if (file.size > MAX_BYTES) {
      toast.error(t('portals.file.tooBig'));
      return;
    }
    if (!/\.(xml|json|csv|txt|xlsx|xls)$/i.test(file.name)) {
      toast.error(t('portals.file.unsupported'));
      return;
    }
    setReading(true);
    try {
      const body: SourceBody = /\.(xlsx|xls)$/i.test(file.name)
        ? { records: matrixToRecords(await readMatrix(file)) }
        : { text: await file.text() };
      setSource(body);
      setFileName(file.name);
      await pv.run(body, { label: portal, deactivate_missing: deactivate });
    } catch {
      toast.error(t('portals.file.readFailed'));
    } finally {
      setReading(false);
    }
  };

  const recalc = () => source && pv.run(source, { label: portal, mapping: pv.mapping, item_path: pv.preview?.item_path, deactivate_missing: deactivate });

  const doImport = async () => {
    if (!source || !pv.preview) return;
    setImporting(true);
    const res = await fetch('/api/real-estate/portals/file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...source, label: portal, mapping: pv.mapping, item_path: pv.preview.item_path, deactivate_missing: deactivate }),
    });
    const data = await res.json().catch(() => ({}));
    setImporting(false);
    if (!res.ok || data.error) {
      toast.error(apiErrorText(t, data.error));
      return;
    }
    const s = data.summary;
    toast.success(t('portals.runs.toast', { created: s.created, updated: s.updated, deactivated: s.deactivated, failed: s.failed }));
    pv.reset();
    setSource(null);
    setFileName('');
    onImported();
  };

  const hasId = Object.values(pv.mapping).includes('external_id');

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor={`${id}-portal`} className="text-sm font-medium">{t('portals.file.origin')}</label>
          <select id={`${id}-portal`} className={selectCls} value={portal} onChange={(e) => setPortal(e.target.value as PortalName)} aria-describedby={`${id}-origin-help`}>
            {PORTAL_NAMES.map((p) => (
              <option key={p} value={p}>{t(`portals.portalNames.${p}`)}</option>
            ))}
          </select>
          <p id={`${id}-origin-help`} className="text-xs text-muted-foreground">{t('portals.file.originHelp')}</p>
        </div>
        <div className="flex items-end">
          <Button type="button" variant="outline" onClick={() => downloadPortalTemplate(t('portals.file.templateFile'))}>
            <Download className="size-4" aria-hidden /> {t('portals.file.template')}
          </Button>
        </div>
        <label className="flex items-start gap-2 text-sm sm:col-span-2">
          <input type="checkbox" className="mt-0.5 size-4 accent-emerald-600" checked={deactivate} onChange={(e) => setDeactivate(e.target.checked)} />
          <span>{t('portals.file.deactivateMissing')}</span>
        </label>
      </div>

      <div>
        <input
          ref={fileRef}
          id={`${id}-file`}
          type="file"
          accept=".xml,.json,.csv,.txt,.xlsx,.xls"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) readFile(f);
          }}
        />
        <Button type="button" variant="outline" onClick={() => fileRef.current?.click()} disabled={reading || pv.loading}>
          {reading || pv.loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <FileUp className="size-4" aria-hidden />}
          {t('portals.file.choose')}
        </Button>
        <p className="mt-1 text-xs text-muted-foreground">{fileName ? t('portals.file.selected', { name: fileName }) : t('portals.file.hint')}</p>
      </div>

      {pv.error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{apiErrorText(t, pv.error)}</p>}

      {pv.preview && (
        <div className="space-y-4">
          <MappingEditor preview={pv.preview} mapping={pv.mapping} fields={fields} onChange={pv.setMapping} />
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="ghost" onClick={recalc} disabled={pv.loading}>
              <RefreshCw className="size-4" aria-hidden /> {t('portals.mapping.recalculate')}
            </Button>
          </div>
          <PlanSummary preview={pv.preview} fields={fields} />
          <Button type="button" onClick={doImport} disabled={importing || !hasId || pv.preview.plan.creates + pv.preview.plan.updates === 0}>
            {importing ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Upload className="size-4" aria-hidden />}
            {importing ? t('portals.file.importing') : t('portals.file.import', { count: pv.preview.plan.creates + pv.preview.plan.updates })}
          </Button>
        </div>
      )}
    </div>
  );
}

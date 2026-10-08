'use client';

import { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Download, FileSpreadsheet, Loader2, Sparkles, Upload } from 'lucide-react';
import { useI18n, useT } from '@/i18n/client';
import { useWorkspace } from '@/hooks/use-workspace';
import { productAttributesFor } from '@/lib/catalog/attributes';
import {
  FIXED_TARGETS,
  MAX_IMPORT_ROWS,
  applyMapping,
  guessMapping,
  normalizeRow,
  planUpsert,
  splitMatrix,
  type ImportPlan,
  type ImportTarget,
  type NormalizedRow,
  type RawRecord,
} from '@/lib/catalog/import';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { MAX_FILE_BYTES, downloadTemplate, isSpreadsheet, readMatrix } from './spreadsheet';
import { ImportPreview } from './import-preview';

export interface CatalogImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful import (at least one row created or updated). */
  onImported?: (result: ImportResult) => void;
}

export interface ImportResult {
  created: number;
  updated: number;
  failed: { row: number; error: string }[];
}

type Step = 'source' | 'mapping' | 'preview' | 'done';
type Tab = 'file' | 'ai';

interface FileData {
  name: string;
  headers: string[];
  rows: { row: number; cells: unknown[] }[];
}

const selectClass =
  'h-8 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring';

/**
 * Bulk catalog import (admins only): spreadsheet → column mapping →
 * preview → import, or pasted text → AI extraction → the same preview.
 */
export function CatalogImportDialog({ open, onOpenChange, onImported }: CatalogImportDialogProps) {
  const t = useT();
  const { locale } = useI18n();
  const { workspace, can, label } = useWorkspace();
  const fields = useMemo(
    () => (workspace ? productAttributesFor(workspace.industry, workspace.settings) : []),
    [workspace],
  );

  const [tab, setTab] = useState<Tab>('file');
  const [step, setStep] = useState<Step>('source');
  const [file, setFile] = useState<FileData | null>(null);
  const [mapping, setMapping] = useState<ImportTarget[]>([]);
  const [text, setText] = useState('');
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState<'read' | 'analyze' | 'check' | 'import' | 'template' | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const itemsLabel = label('productPlural');
  const loc = locale === 'en' ? 'en' : 'es';

  if (!workspace || !can('admin')) return null;

  const reset = () => {
    setStep('source');
    setFile(null);
    setMapping([]);
    setText('');
    setPlan(null);
    setResult(null);
    setBusy(null);
  };

  const close = () => {
    reset();
    onOpenChange(false);
  };

  // ---- source: file ----
  const pickFile = async (f: File) => {
    if (!isSpreadsheet(f)) return toast.error(t('catalogImport.file.unsupported'));
    if (f.size > MAX_FILE_BYTES) return toast.error(t('catalogImport.file.tooBig'));
    setBusy('read');
    try {
      const { headers, rows } = splitMatrix(await readMatrix(f));
      if (rows.length === 0 || headers.length === 0) return toast.error(t('catalogImport.file.empty'));
      if (rows.length > MAX_IMPORT_ROWS) {
        return toast.error(t('catalogImport.file.tooMany', { count: rows.length, max: MAX_IMPORT_ROWS }));
      }
      setFile({ name: f.name, headers, rows });
      setMapping(guessMapping(headers, fields));
      setStep('mapping');
    } catch (err) {
      console.error('[catalog import] read failed', err);
      toast.error(t('catalogImport.file.failed'));
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const template = async () => {
    setBusy('template');
    try {
      await downloadTemplate(
        fields,
        loc,
        {
          name: t('catalogImport.template.exampleName', { product: label('product') }),
          description: t('catalogImport.template.exampleDescription'),
          category: t('catalogImport.template.exampleCategory'),
          tags: t('catalogImport.template.exampleTags'),
          yes: t('catalogImport.template.yes'),
        },
        `${t('catalogImport.template.fileName')}-${workspace.industry}`,
      );
    } finally {
      setBusy(null);
    }
  };

  // ---- preview (shared by both sources) ----
  const buildPreview = async (records: { row: number; raw: RawRecord }[]) => {
    const normalized: NormalizedRow[] = records.map((r) => normalizeRow(r.raw, fields, r.row));
    const skus = [...new Set(normalized.map((r) => r.data.sku).filter((s): s is string => !!s))];
    let existing: Record<string, string> = {};
    if (skus.length) {
      setBusy('check');
      try {
        const res = await fetch('/api/catalog/import/check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ skus }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || t('catalogImport.failed'));
        existing = data.existing ?? {};
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t('catalogImport.failed'));
        return;
      } finally {
        setBusy(null);
      }
    }
    setPlan(planUpsert(normalized, existing, fields));
    setStep('preview');
  };

  const continueFromMapping = () => {
    if (!file) return;
    buildPreview(file.rows.map((r) => ({ row: r.row, raw: applyMapping(r.cells, mapping) })));
  };

  // ---- source: AI ----
  const analyze = async () => {
    if (!text.trim()) return;
    setBusy('analyze');
    let rows: RawRecord[] = [];
    try {
      const res = await fetch('/api/catalog/import/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || t('catalogImport.ai.failed'));
      rows = data.rows ?? [];
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('catalogImport.ai.failed'));
      return;
    } finally {
      setBusy(null);
    }
    if (rows.length === 0) return toast.info(t('catalogImport.ai.nothingFound', { items: itemsLabel.toLowerCase() }));
    setFile(null);
    await buildPreview(rows.map((raw, i) => ({ row: i + 1, raw })));
  };

  // ---- import ----
  const runImport = async () => {
    if (!plan) return;
    const rows = plan.rows.filter((r) => r.action !== 'error').map((r) => ({ ...r.data, row: r.row }));
    if (rows.length === 0) return;
    setBusy('import');
    try {
      const res = await fetch('/api/catalog/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || t('catalogImport.failed'));
      const outcome: ImportResult = { created: data.created ?? 0, updated: data.updated ?? 0, failed: data.failed ?? [] };
      setResult(outcome);
      setStep('done');
      if (outcome.created + outcome.updated > 0) {
        toast.success(t('catalogImport.done.toast', { created: outcome.created, updated: outcome.updated }));
        onImported?.(outcome);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('catalogImport.failed'));
    } finally {
      setBusy(null);
    }
  };

  const targetLabel = (target: ImportTarget) =>
    target.startsWith('attr:')
      ? fields.find((f) => f.key === target.slice(5))?.label[loc] ?? target.slice(5)
      : t(`catalogImport.fields.${target}`);

  const used = new Set(mapping.filter(Boolean));
  const hasName = mapping.includes('name');
  const importable = plan ? plan.creates + plan.updates : 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{t('catalogImport.title', { items: itemsLabel.toLowerCase() })}</DialogTitle>
          <DialogDescription>{t('catalogImport.description')}</DialogDescription>
        </DialogHeader>

        <ol className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label={t('catalogImport.steps.source')}>
          {(['source', 'mapping', 'preview', 'done'] as Step[])
            .filter((s) => s !== 'mapping' || tab === 'file')
            .map((s, i) => (
              <li key={s} aria-current={s === step ? 'step' : undefined} className={s === step ? 'font-medium text-foreground' : undefined}>
                {i + 1}. {t(`catalogImport.steps.${s}`)}
              </li>
            ))}
        </ol>

        {step === 'source' && (
          <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
            <TabsList>
              <TabsTrigger value="file">
                <FileSpreadsheet className="size-4" />
                {t('catalogImport.tabs.file')}
              </TabsTrigger>
              <TabsTrigger value="ai">
                <Sparkles className="size-4" />
                {t('catalogImport.tabs.ai')}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="file" className="grid gap-3 pt-2">
              <input
                ref={fileRef}
                type="file"
                className="hidden"
                accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) pickFile(f);
                }}
              />
              <button
                type="button"
                disabled={!!busy}
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  const f = e.dataTransfer.files?.[0];
                  if (f) pickFile(f);
                }}
                className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-10 text-center text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  dragging ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50'
                }`}
              >
                {busy === 'read' ? <Loader2 className="size-6 animate-spin text-muted-foreground" /> : <Upload className="size-6 text-muted-foreground" />}
                <span className="font-medium text-foreground">{busy === 'read' ? t('catalogImport.file.reading') : t('catalogImport.file.drop')}</span>
                <span className="text-xs text-muted-foreground">{t('catalogImport.file.hint', { max: MAX_IMPORT_ROWS.toLocaleString(loc) })}</span>
              </button>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Button type="button" variant="outline" size="sm" onClick={template} disabled={!!busy}>
                  {busy === 'template' ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
                  {t('catalogImport.file.template')}
                </Button>
                {t('catalogImport.file.templateHint')}
              </div>
            </TabsContent>

            <TabsContent value="ai" className="grid gap-2 pt-2">
              <label htmlFor="catalog-import-text" className="text-sm font-medium">
                {t('catalogImport.ai.label')}
              </label>
              <Textarea
                id="catalog-import-text"
                rows={12}
                value={text}
                maxLength={30000}
                placeholder={t('catalogImport.ai.placeholder', { items: itemsLabel.toLowerCase() })}
                onChange={(e) => setText(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">{t('catalogImport.ai.hint')}</p>
            </TabsContent>
          </Tabs>
        )}

        {step === 'mapping' && file && (
          <div className="grid gap-3">
            <p className="text-sm text-muted-foreground">
              {t('catalogImport.mapping.intro', { file: file.name, count: file.rows.length })}
            </p>
            <div className="max-h-[55vh] overflow-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted text-left text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-medium">{t('catalogImport.mapping.column')}</th>
                    <th scope="col" className="px-3 py-2 font-medium">{t('catalogImport.mapping.sample')}</th>
                    <th scope="col" className="w-56 px-3 py-2 font-medium">{t('catalogImport.mapping.target')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {file.headers.map((h, i) => {
                    const sample = file.rows.find((r) => String(r.cells[i] ?? '').trim())?.cells[i];
                    return (
                      <tr key={i}>
                        <td className="px-3 py-1.5 font-medium">{h || `#${i + 1}`}</td>
                        <td className="max-w-[16rem] truncate px-3 py-1.5 text-muted-foreground" title={String(sample ?? '')}>
                          {String(sample ?? '')}
                        </td>
                        <td className="px-3 py-1.5">
                          <select
                            className={selectClass}
                            aria-label={`${t('catalogImport.mapping.target')}: ${h || `#${i + 1}`}`}
                            value={mapping[i] ?? ''}
                            onChange={(e) => setMapping((m) => m.map((x, j) => (j === i ? (e.target.value as ImportTarget) : x)))}
                          >
                            <option value="">{t('catalogImport.mapping.ignore')}</option>
                            <optgroup label={t('catalogImport.mapping.fixed')}>
                              {FIXED_TARGETS.map((f) => (
                                <option key={f} value={f} disabled={used.has(f) && mapping[i] !== f}>
                                  {targetLabel(f)}
                                </option>
                              ))}
                            </optgroup>
                            {fields.length > 0 && (
                              <optgroup label={t('catalogImport.mapping.attributes', { product: label('product') })}>
                                {fields.map((f) => {
                                  const v = `attr:${f.key}` as ImportTarget;
                                  return (
                                    <option key={f.key} value={v} disabled={used.has(v) && mapping[i] !== v}>
                                      {f.label[loc]}
                                    </option>
                                  );
                                })}
                              </optgroup>
                            )}
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {!hasName && <p className="text-sm text-destructive">{t('catalogImport.mapping.needName')}</p>}
          </div>
        )}

        {step === 'preview' && plan && <ImportPreview plan={plan} targetLabel={targetLabel} />}

        {step === 'done' && result && (
          <div className="grid gap-4" aria-live="polite">
            <p className="font-medium">{t('catalogImport.done.title')}</p>
            <dl className="grid grid-cols-3 gap-3 text-center">
              {(['created', 'updated', 'failed'] as const).map((k) => (
                <div key={k} className="rounded-lg border border-border p-3">
                  <dt className="text-xs text-muted-foreground">{t(`catalogImport.done.${k}`)}</dt>
                  <dd className={`text-2xl font-semibold ${k === 'failed' && result.failed.length ? 'text-destructive' : ''}`}>
                    {k === 'failed' ? result.failed.length : result[k]}
                  </dd>
                </div>
              ))}
            </dl>
            {result.failed.length > 0 && (
              <div className="grid gap-1">
                <p className="text-sm font-medium">{t('catalogImport.done.failedRows')}</p>
                <ul className="max-h-48 overflow-y-auto rounded-lg border border-border text-sm">
                  {result.failed.map((f) => (
                    <li key={f.row} className="border-b border-border px-3 py-1.5 last:border-0">
                      <span className="font-medium">{t('catalogImport.preview.row')} {f.row}:</span>{' '}
                      <span className="text-muted-foreground">{f.error}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {step === 'source' && (
            <>
              <Button type="button" variant="outline" onClick={close}>
                {t('catalogImport.cancel')}
              </Button>
              {tab === 'ai' && (
                <Button type="button" onClick={analyze} disabled={!text.trim() || !!busy}>
                  {busy === 'analyze' || busy === 'check' ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                  {busy === 'analyze' ? t('catalogImport.ai.analyzing') : t('catalogImport.ai.analyze')}
                </Button>
              )}
            </>
          )}
          {step === 'mapping' && (
            <>
              <Button type="button" variant="outline" onClick={reset} disabled={!!busy}>
                {t('catalogImport.back')}
              </Button>
              <Button type="button" onClick={continueFromMapping} disabled={!hasName || !!busy}>
                {busy === 'check' && <Loader2 className="size-4 animate-spin" />}
                {busy === 'check' ? t('catalogImport.preview.checking') : t('catalogImport.mapping.continue')}
              </Button>
            </>
          )}
          {step === 'preview' && (
            <>
              <Button type="button" variant="outline" onClick={() => setStep(file ? 'mapping' : 'source')} disabled={!!busy}>
                {t('catalogImport.back')}
              </Button>
              <Button type="button" onClick={runImport} disabled={importable === 0 || !!busy}>
                {busy === 'import' && <Loader2 className="size-4 animate-spin" />}
                {busy === 'import' ? t('catalogImport.preview.importing') : t('catalogImport.preview.import', { count: importable })}
              </Button>
            </>
          )}
          {step === 'done' && (
            <>
              <Button type="button" variant="outline" onClick={reset}>
                {t('catalogImport.done.again')}
              </Button>
              <Button type="button" onClick={close}>
                {t('catalogImport.done.close')}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

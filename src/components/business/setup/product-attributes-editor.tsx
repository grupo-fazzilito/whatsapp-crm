'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useI18n, useT } from '@/i18n/client';
import { useWorkspace } from '@/hooks/use-workspace';
import { createClient } from '@/lib/supabase/client';
import { getPreset, type AttributeField, type AttributeType } from '@/lib/industries';
import type { Workspace, WorkspaceSettings } from '@/lib/workspace/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { invalidateAi, selectClass } from '../shared';

const TYPES: AttributeType[] = ['text', 'textarea', 'number', 'select', 'multiselect', 'boolean'];
const MAX_FIELDS = 30;

/** "Tipo de piel" → "tipo_de_piel" (the key stored in products.attributes). */
export function attributeKey(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/ñ/g, 'n')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

interface Draft {
  /** Key of the field being edited, null for a new one. */
  originalKey: string | null;
  key: string;
  keyTouched: boolean;
  labelEs: string;
  labelEn: string;
  type: AttributeType;
  options: { value: string; es: string; en: string }[];
  unit: string;
  required: boolean;
  filterable: boolean;
}

const emptyDraft = (): Draft => ({
  originalKey: null,
  key: '',
  keyTouched: false,
  labelEs: '',
  labelEn: '',
  type: 'text',
  options: [],
  unit: '',
  required: false,
  filterable: false,
});

function toDraft(f: AttributeField): Draft {
  return {
    originalKey: f.key,
    key: f.key,
    keyTouched: true,
    labelEs: f.label.es,
    labelEn: f.label.en === f.label.es ? '' : f.label.en,
    type: f.type,
    options: (f.options ?? []).map((o) => ({ value: o.value, es: o.label.es, en: o.label.en === o.label.es ? '' : o.label.en })),
    unit: f.unit ?? '',
    required: !!f.required,
    filterable: !!f.filterable,
  };
}

/**
 * Business setup → industry tab: the industry's preset product fields
 * (read-only) plus the workspace's own fields, stored in
 * workspaces.settings.product_attributes.
 */
export function ProductAttributesEditor({ workspace, industry, readOnly }: { workspace: Workspace; industry: string; readOnly: boolean }) {
  const t = useT();
  const { locale } = useI18n();
  const { refresh, label } = useWorkspace();
  const preset = getPreset(industry).productAttributes;
  const presetKeys = new Set(preset.map((f) => f.key));
  const [custom, setCustom] = useState<AttributeField[]>(() =>
    Array.isArray(workspace.settings?.product_attributes) ? (workspace.settings.product_attributes as AttributeField[]) : [],
  );
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [deleting, setDeleting] = useState<AttributeField | null>(null);
  const [saving, setSaving] = useState(false);
  const products = label('productPlural').toLowerCase();

  const persist = async (next: AttributeField[]) => {
    setSaving(true);
    const db = createClient();
    // Merge into the latest settings so other tabs' changes are kept.
    const { data, error: readErr } = await db.from('workspaces').select('settings').eq('id', workspace.id).single();
    if (readErr) {
      setSaving(false);
      toast.error(readErr.message);
      return false;
    }
    const settings: WorkspaceSettings = { ...((data?.settings as WorkspaceSettings) ?? {}), product_attributes: next };
    const { error } = await db.from('workspaces').update({ settings }).eq('id', workspace.id);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return false;
    }
    setCustom(next);
    await invalidateAi();
    await refresh();
    toast.success(t('catalog.attributes.saved'));
    return true;
  };

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    const errs: Record<string, string> = {};
    const key = draft.key.trim();
    if (!draft.labelEs.trim()) errs.label = t('catalog.attributes.error.label');
    if (!/^[a-z0-9_]+$/.test(key)) errs.key = t('catalog.attributes.error.key');
    else if (presetKeys.has(key)) errs.key = t('catalog.attributes.error.keyPreset');
    else if (custom.some((f) => f.key === key && f.key !== draft.originalKey)) errs.key = t('catalog.attributes.error.keyTaken');
    const needsOptions = draft.type === 'select' || draft.type === 'multiselect';
    const options = draft.options
      .filter((o) => o.es.trim())
      .map((o) => {
        const es = o.es.trim().slice(0, 80);
        return { value: o.value || attributeKey(es) || es.toLowerCase(), label: { es, en: o.en.trim().slice(0, 80) || es } };
      });
    if (needsOptions && options.length === 0) errs.options = t('catalog.attributes.error.options');
    if (new Set(options.map((o) => o.value)).size !== options.length) errs.options = t('catalog.attributes.error.optionsDup');
    setErrors(errs);
    if (Object.keys(errs).length) return;

    const labelEs = draft.labelEs.trim().slice(0, 60);
    const field: AttributeField = {
      key,
      type: draft.type,
      label: { es: labelEs, en: draft.labelEn.trim().slice(0, 60) || labelEs },
      ...(needsOptions ? { options } : {}),
      ...(draft.unit.trim() && draft.type === 'number' ? { unit: draft.unit.trim().slice(0, 12) } : {}),
      ...(draft.required ? { required: true } : {}),
      ...(draft.filterable ? { filterable: true } : {}),
    };
    const next =
      draft.originalKey === null ? [...custom, field] : custom.map((f) => (f.key === draft.originalKey ? field : f));
    if (await persist(next)) setDraft(null);
  };

  const typeName = (ty: AttributeType) => t(`catalog.attributes.type.${ty}`);
  const flags = (f: AttributeField) =>
    [f.unit, f.required && t('catalog.attributes.required'), f.filterable && t('catalog.attributes.filterable')].filter(Boolean).join(' · ');

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('catalog.attributes.title')}</CardTitle>
        <CardDescription>{t('catalog.attributes.description', { products })}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <ul className="grid gap-2">
          {preset.map((f) => (
            <li key={f.key} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 p-3">
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
                  {f.label[locale]}
                  <Badge variant="outline">{t('catalog.attributes.preset')}</Badge>
                </span>
                <span className="block text-xs text-muted-foreground">
                  {typeName(f.type)}
                  {flags(f) && ` · ${flags(f)}`}
                </span>
              </span>
            </li>
          ))}
          {custom.map((f) => (
            <li key={f.key} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
              <span className="min-w-0">
                <span className="block text-sm font-medium text-foreground">{f.label[locale] || f.label.es}</span>
                <span className="block text-xs text-muted-foreground">
                  {typeName(f.type)} · <code>{f.key}</code>
                  {flags(f) && ` · ${flags(f)}`}
                </span>
              </span>
              {!readOnly && (
                <span className="flex gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('catalog.editItem', { item: f.label[locale] })}
                    onClick={() => {
                      setErrors({});
                      setDraft(toDraft(f));
                    }}
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="text-destructive"
                    aria-label={t('catalog.deleteItem', { item: f.label[locale] })}
                    onClick={() => setDeleting(f)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </span>
              )}
            </li>
          ))}
          {preset.length === 0 && custom.length === 0 && (
            <li className="text-sm text-muted-foreground">{t('catalog.attributes.empty')}</li>
          )}
        </ul>
        {!readOnly && custom.length < MAX_FIELDS && (
          <Button
            type="button"
            variant="outline"
            className="w-fit"
            onClick={() => {
              setErrors({});
              setDraft(emptyDraft());
            }}
          >
            <Plus className="size-4" />
            {t('catalog.attributes.add')}
          </Button>
        )}
      </CardContent>

      {draft && (
        <Dialog open onOpenChange={(o) => !o && setDraft(null)}>
          <DialogContent className="sm:max-w-lg">
            <form onSubmit={submit} className="grid gap-4" noValidate>
              <DialogHeader>
                <DialogTitle>{draft.originalKey ? t('catalog.attributes.edit') : t('catalog.attributes.add')}</DialogTitle>
                <DialogDescription>{t('catalog.attributes.dialogDescription')}</DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="pa-label-es">{t('catalog.attributes.labelEs')}</Label>
                  <Input
                    id="pa-label-es"
                    maxLength={60}
                    value={draft.labelEs}
                    aria-invalid={!!errors.label}
                    aria-describedby={errors.label ? 'pa-label-err' : undefined}
                    onChange={(e) => {
                      const v = e.target.value;
                      setDraft((d) => (d ? { ...d, labelEs: v, key: d.keyTouched ? d.key : attributeKey(v) } : d));
                    }}
                  />
                  {errors.label && (
                    <p id="pa-label-err" className="text-xs text-destructive">
                      {errors.label}
                    </p>
                  )}
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="pa-label-en">{t('catalog.attributes.labelEn')}</Label>
                  <Input id="pa-label-en" maxLength={60} value={draft.labelEn} placeholder={draft.labelEs} onChange={(e) => set('labelEn', e.target.value)} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="pa-key">{t('catalog.attributes.key')}</Label>
                  <Input
                    id="pa-key"
                    maxLength={40}
                    value={draft.key}
                    className="font-mono text-xs"
                    aria-invalid={!!errors.key}
                    aria-describedby={errors.key ? 'pa-key-err' : 'pa-key-hint'}
                    onChange={(e) => setDraft((d) => (d ? { ...d, key: e.target.value.toLowerCase(), keyTouched: true } : d))}
                  />
                  {errors.key ? (
                    <p id="pa-key-err" className="text-xs text-destructive">
                      {errors.key}
                    </p>
                  ) : (
                    <p id="pa-key-hint" className="text-xs text-muted-foreground">
                      {t('catalog.attributes.keyHint')}
                    </p>
                  )}
                </div>
                <div className="grid content-start gap-1.5">
                  <Label htmlFor="pa-type">{t('catalog.attributes.typeLabel')}</Label>
                  <select id="pa-type" className={selectClass} value={draft.type} onChange={(e) => set('type', e.target.value as AttributeType)}>
                    {TYPES.map((ty) => (
                      <option key={ty} value={ty}>
                        {typeName(ty)}
                      </option>
                    ))}
                  </select>
                </div>
                {draft.type === 'number' && (
                  <div className="grid gap-1.5">
                    <Label htmlFor="pa-unit">{t('catalog.attributes.unit')}</Label>
                    <Input id="pa-unit" maxLength={12} placeholder="m², kg, ml…" value={draft.unit} onChange={(e) => set('unit', e.target.value)} />
                  </div>
                )}
              </div>

              {(draft.type === 'select' || draft.type === 'multiselect') && (
                <fieldset className="grid gap-2">
                  <legend className="mb-1 text-sm font-medium text-foreground">{t('catalog.attributes.options')}</legend>
                  {draft.options.map((o, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Input
                        aria-label={t('catalog.attributes.optionEs', { n: i + 1 })}
                        placeholder={t('catalog.attributes.optionEsPlaceholder')}
                        maxLength={80}
                        value={o.es}
                        onChange={(e) => set('options', draft.options.map((x, j) => (j === i ? { ...x, es: e.target.value } : x)))}
                      />
                      <Input
                        aria-label={t('catalog.attributes.optionEn', { n: i + 1 })}
                        placeholder={o.es || 'English'}
                        maxLength={80}
                        value={o.en}
                        onChange={(e) => set('options', draft.options.map((x, j) => (j === i ? { ...x, en: e.target.value } : x)))}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t('catalog.attributes.removeOption', { n: i + 1 })}
                        onClick={() => set('options', draft.options.filter((_, j) => j !== i))}
                      >
                        <X className="size-3.5" />
                      </Button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="w-fit"
                    onClick={() => set('options', [...draft.options, { value: '', es: '', en: '' }])}
                  >
                    <Plus className="size-3.5" />
                    {t('catalog.attributes.addOption')}
                  </Button>
                  {errors.options && <p className="text-xs text-destructive">{errors.options}</p>}
                </fieldset>
              )}

              <div className="grid gap-2 sm:grid-cols-2">
                <label className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm text-foreground">
                  {t('catalog.attributes.required')}
                  <Switch checked={draft.required} onCheckedChange={(v) => set('required', v)} />
                </label>
                <label className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm text-foreground">
                  <span>
                    {t('catalog.attributes.filterable')}
                    <span className="block text-xs text-muted-foreground">{t('catalog.attributes.filterableHint')}</span>
                  </span>
                  <Switch checked={draft.filterable} onCheckedChange={(v) => set('filterable', v)} />
                </label>
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDraft(null)}>
                  {t('catalog.cancel')}
                </Button>
                <Button type="submit" disabled={saving}>
                  {saving && <Loader2 className="size-4 animate-spin" />}
                  {t('catalog.save')}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}

      <ConfirmationDialog
        isOpen={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t('catalog.deleteTitle', { name: deleting?.label[locale] ?? '' })}
        description={t('catalog.attributes.deleteDescription', { products })}
        confirmText={t('catalog.delete')}
        cancelText={t('catalog.cancel')}
        variant="destructive"
        onConfirm={async () => {
          if (deleting) await persist(custom.filter((f) => f.key !== deleting.key));
        }}
      />
    </Card>
  );
}

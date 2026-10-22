'use client';

import { useEffect, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useT } from '@/i18n/client';
import { useWorkspace } from '@/hooks/use-workspace';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { FIELD_TYPES, optionsOf, type CustomField, type FieldType } from '@/lib/crm/custom-fields';

interface Draft {
  id: string | null;
  field_name: string;
  field_type: FieldType;
  options: string;
}

const EMPTY: Draft = { id: null, field_name: '', field_type: 'text', options: '' };

const selectClass =
  'h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring';

/** Settings → Custom fields: create, rename, retype and delete the workspace's contact fields. */
export function CustomFieldsManager() {
  const t = useT();
  const { can } = useWorkspace();
  const isAdmin = can('admin');
  const [fields, setFields] = useState<CustomField[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/crm/custom-fields', { cache: 'no-store' })
      .then((r) => (r.ok ? (r.json() as Promise<{ fields: CustomField[] }>) : { fields: [] }))
      .catch(() => ({ fields: [] }))
      .then((d) => {
        if (!cancelled) setFields(d.fields);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function save() {
    if (!draft) return;
    setBusy(true);
    try {
      const res = await fetch(draft.id ? `/api/crm/custom-fields/${draft.id}` : '/api/crm/custom-fields', {
        method: draft.id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          field_name: draft.field_name,
          field_type: draft.field_type,
          field_options: draft.field_type === 'select' ? draft.options.split('\n') : null,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { field?: CustomField; error?: string };
      if (!res.ok || !data.field) {
        toast.error(data.error ? t(`crm.customFields.errors.${data.error}`) : t('common.error'));
        return;
      }
      const saved = data.field;
      setFields((prev) => (draft.id ? (prev ?? []).map((f) => (f.id === saved.id ? saved : f)) : [...(prev ?? []), saved]));
      setDraft(null);
      toast.success(t('crm.customFields.saved'));
    } finally {
      setBusy(false);
    }
  }

  async function remove(f: CustomField) {
    if (!window.confirm(t('crm.customFields.deleteConfirm', { name: f.field_name }))) return;
    const res = await fetch(`/api/crm/custom-fields/${f.id}`, { method: 'DELETE' });
    if (!res.ok) return void toast.error(t('common.error'));
    setFields((prev) => (prev ?? []).filter((x) => x.id !== f.id));
    toast.success(t('crm.customFields.deleted'));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('crm.customFields.title')}</CardTitle>
        <CardDescription>{t('crm.customFields.description')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {!isAdmin && <p className="text-sm text-muted-foreground">{t('crm.customFields.adminOnly')}</p>}

        {fields === null ? null : fields.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('crm.customFields.empty')}</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {fields.map((f) => (
              <li key={f.id} className="flex items-center gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{f.field_name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {t(`crm.customFields.types.${FIELD_TYPES.includes(f.field_type as FieldType) ? f.field_type : 'text'}`)}
                    {f.field_type === 'select' && ` · ${optionsOf(f).join(', ')}`}
                  </p>
                </div>
                {isAdmin && (
                  <>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`${t('crm.customFields.edit')}: ${f.field_name}`}
                      onClick={() =>
                        setDraft({
                          id: f.id,
                          field_name: f.field_name,
                          field_type: (FIELD_TYPES.includes(f.field_type as FieldType) ? f.field_type : 'text') as FieldType,
                          options: optionsOf(f).join('\n'),
                        })
                      }
                    >
                      <Pencil className="size-4" />
                    </Button>
                    <Button variant="ghost" size="icon-sm" aria-label={`${t('crm.customFields.delete')}: ${f.field_name}`} onClick={() => void remove(f)}>
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}

        {isAdmin && !draft && (
          <Button variant="outline" className="justify-self-start" onClick={() => setDraft({ ...EMPTY })}>
            <Plus className="size-4" />
            {t('crm.customFields.add')}
          </Button>
        )}

        {isAdmin && draft && (
          <div className="grid gap-3 rounded-lg border border-border p-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="cf-name">{t('crm.customFields.name')}</Label>
                <Input id="cf-name" maxLength={60} value={draft.field_name} onChange={(e) => setDraft({ ...draft, field_name: e.target.value })} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="cf-type">{t('crm.customFields.type')}</Label>
                <select
                  id="cf-type"
                  className={selectClass}
                  value={draft.field_type}
                  onChange={(e) => setDraft({ ...draft, field_type: e.target.value as FieldType })}
                >
                  {FIELD_TYPES.map((ft) => (
                    <option key={ft} value={ft}>
                      {t(`crm.customFields.types.${ft}`)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {draft.field_type === 'select' && (
              <div className="grid gap-1.5">
                <Label htmlFor="cf-options">{t('crm.customFields.options')}</Label>
                <Textarea
                  id="cf-options"
                  rows={4}
                  value={draft.options}
                  onChange={(e) => setDraft({ ...draft, options: e.target.value })}
                  aria-describedby="cf-options-help"
                />
                <p id="cf-options-help" className="text-xs text-muted-foreground">
                  {t('crm.customFields.optionsHelp')}
                </p>
              </div>
            )}
            <div className="flex gap-2">
              <Button onClick={() => void save()} disabled={busy}>
                {t('crm.customFields.save')}
              </Button>
              <Button variant="ghost" onClick={() => setDraft(null)} disabled={busy}>
                {t('crm.customFields.cancel')}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

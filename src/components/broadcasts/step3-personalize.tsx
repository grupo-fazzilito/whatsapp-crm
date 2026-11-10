'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useWorkspace } from '@/hooks/use-workspace';
import type { TemplateVariable, VariableSource } from '@/lib/templates/model';
import { Contact, CustomField, MessageTemplate } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ArrowLeft, ArrowRight, Eye, Loader2, FileText } from 'lucide-react';
import { useT } from '@/i18n/client';

type VariableType = 'static' | 'field' | 'custom_field';

interface VariableMapping {
  type: VariableType;
  value: string;
}

interface Step3Props {
  template: MessageTemplate;
  variables: Record<string, VariableMapping>;
  onUpdate: (variables: Record<string, VariableMapping>) => void;
  onNext: () => void;
  onBack: () => void;
}

const contactFields = ['name', 'phone', 'email', 'company'] as const;

/** Contact field a template variable source maps to. */
const SOURCE_FIELD: Partial<Record<VariableSource, string>> = {
  'contact.name': 'name',
  'contact.phone': 'phone',
  'contact.email': 'email',
  'contact.company': 'company',
};

type TemplateWithVariables = MessageTemplate & { variables?: TemplateVariable[] | null };

const SAMPLE_CONTACT: Contact = {
  id: 'sample',
  workspace_id: '',
  user_id: '',
  name: 'John Doe',
  phone: '+1234567890',
  email: 'john@example.com',
  company: 'Acme Corp',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

export function Step3Personalize({
  template,
  variables,
  onUpdate,
  onNext,
  onBack,
}: Step3Props) {
  const t = useT();
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [loadingFields, setLoadingFields] = useState(true);
  const [firstContact, setFirstContact] = useState<Contact | null>(null);
  const [firstContactCustomValues, setFirstContactCustomValues] = useState<
    Map<string, string>
  >(new Map());
  const [loadingPreview, setLoadingPreview] = useState(true);
  const { workspace } = useWorkspace();
  const ownVariables = (template as TemplateWithVariables).variables;
  const [fetchedVariables, setFetchedVariables] = useState<TemplateVariable[] | null>(null);
  const templateVariables = useMemo<TemplateVariable[]>(
    () => (Array.isArray(ownVariables) ? ownVariables : fetchedVariables ?? []),
    [ownVariables, fetchedVariables],
  );

  // Older template objects may come without `variables`: read them from the
  // templates API (labels and data sources defined in the editor).
  useEffect(() => {
    if (Array.isArray(ownVariables)) return;
    let cancelled = false;
    fetch('/api/whatsapp/templates', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { templates?: { id: string; variables?: TemplateVariable[] }[] } | null) => {
        if (cancelled || !d) return;
        const found = d.templates?.find((x) => x.id === template.id);
        if (found && Array.isArray(found.variables)) setFetchedVariables(found.variables);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [ownVariables, template.id]);

  /** Variable defined in the editor for a body position ({{n}}). */
  const bodyVariable = (num: string) => templateVariables.find((v) => v.index === Number(num));
  /** Header variables are numbered on their own on Meta's side ({{1}}); they have no body index. */
  const headerVariable = (num: string) => {
    const headerOnly = templateVariables.filter((v) => v.index === undefined || v.index === null);
    return headerOnly[Number(num) - 1];
  };

  // Pre-fill the mapping of variables whose source is a contact field or the
  // business name, once per template; never overwrites what the user set.
  const prefilled = useRef<string | null>(null);

  // Load user's custom fields + a representative contact for the
  // live preview. Fall back to sample data if no contacts exist yet.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let data: {
        custom_fields?: CustomField[];
        sample?: { contact: Contact | null; custom_values: { custom_field_id: string; value: string | null }[] };
      } = {};
      try {
        const res = await fetch('/api/broadcasts/setup?include=custom_fields,sample', { cache: 'no-store' });
        if (res.ok) data = await res.json();
      } catch {
        // offline — fall back to sample data below
      }
      if (cancelled) return;

      setCustomFields(data.custom_fields ?? []);
      setLoadingFields(false);

      const contact = data.sample?.contact ?? null;
      setFirstContact(contact);

      if (contact) {
        const map = new Map<string, string>();
        for (const row of data.sample?.custom_values ?? []) {
          map.set(row.custom_field_id, row.value ?? '');
        }
        setFirstContactCustomValues(map);
      }
      setLoadingPreview(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const headerPlaceholders = useMemo(() => {
    if (template.header_type !== 'text' || !template.header_content) return [];
    const matches = template.header_content.match(/\{\{(\d+)\}\}/g);
    if (!matches) return [];
    return [...new Set(matches)].sort();
  }, [template.header_type, template.header_content]);

  const bodyPlaceholders = useMemo(() => {
    const matches = template.body_text.match(/\{\{(\d+)\}\}/g);
    if (!matches) return [];
    return [...new Set(matches)].sort((a, b) => {
      return Number(a.replace(/^\{\{|\}\}$/g, '')) - Number(b.replace(/^\{\{|\}\}$/g, ''));
    });
  }, [template.body_text]);

  const buttonPlaceholders = useMemo(() => {
    if (!template.buttons || !Array.isArray(template.buttons)) return [];
    const list: { buttonIndex: number; buttonText: string; placeholder: string }[] = [];
    (template.buttons as any[]).forEach((btn: any, buttonIndex: number) => {
      const url = (btn.url ?? btn.value) as string | undefined;
      if ((btn.type === 'URL' || btn.type === 'url') && url) {
        const matches = url.match(/\{\{(\d+)\}\}/g);
        if (matches) {
          const uniqueMatches = Array.from(new Set(matches)) as string[];
          uniqueMatches.forEach((m) => {
            list.push({
              buttonIndex,
              buttonText: (btn.text as string) || t('bc.s3.button'),
              placeholder: m,
            });
          });
        }
      }
    });
    return list;
  }, [template.buttons, t]);

  useEffect(() => {
    if (!templateVariables.length || prefilled.current === template.id) return;
    prefilled.current = template.id;
    const next = { ...variables };
    let changed = false;
    const fill = (key: string, v: TemplateVariable | undefined) => {
      if (!v || v.source === 'manual' || next[key]?.value?.trim()) return;
      const field = SOURCE_FIELD[v.source];
      if (field) next[key] = { type: 'field', value: field };
      else if (v.source === 'workspace.name' && workspace?.name) next[key] = { type: 'static', value: workspace.name };
      else return;
      changed = true;
    };
    for (const p of bodyPlaceholders) {
      const num = p.replace(/^\{\{|\}\}$/g, '');
      fill(`body_${num}`, bodyVariable(num));
    }
    for (const p of headerPlaceholders) {
      const num = p.replace(/^\{\{|\}\}$/g, '');
      fill(`header_${num}`, headerVariable(num));
    }
    if (changed) onUpdate(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateVariables, template.id, bodyPlaceholders, headerPlaceholders, workspace?.name]);

  const hasAnyPlaceholders =
    headerPlaceholders.length > 0 ||
    bodyPlaceholders.length > 0 ||
    buttonPlaceholders.length > 0;

  const unmappedKeys = useMemo(() => {
    const missing: string[] = [];
    
    for (const p of headerPlaceholders) {
      const num = p.replace(/^\{\{|\}\}$/g, '');
      const key = `header_${num}`;
      const mapping = variables[key];
      if (!mapping || !mapping.value?.trim()) missing.push(t('bc.s3.missingHeader', { p }));
    }

    for (const p of bodyPlaceholders) {
      const num = p.replace(/^\{\{|\}\}$/g, '');
      const key = `body_${num}`;
      const mapping = variables[key] ?? variables[num]; 
      if (!mapping || !mapping.value?.trim()) missing.push(t('bc.s3.missingBody', { p }));
    }

    for (const btn of buttonPlaceholders) {
      const num = btn.placeholder.replace(/^\{\{|\}\}$/g, '');
      const key = `button_${btn.buttonIndex}_${num}`;
      const mapping = variables[key];
      if (!mapping || !mapping.value?.trim()) {
        missing.push(t('bc.s3.missingButton', { button: btn.buttonText, p: btn.placeholder }));
      }
    }

    return missing;
  }, [headerPlaceholders, bodyPlaceholders, buttonPlaceholders, variables, t]);

  function updateVariable(key: string, patch: Partial<VariableMapping>) {
    const current = variables[key] ?? { type: 'static' as VariableType, value: '' };
    onUpdate({
      ...variables,
      [key]: { ...current, ...patch },
    });
  }

  function resolveMappingValue(
    mapping: VariableMapping | undefined,
    contact: Contact,
    customValues: Map<string, string>,
  ): string {
    if (!mapping) return '';
    if (mapping.type === 'static') return mapping.value;
    if (mapping.type === 'field') {
      const fieldMap: Record<string, string | undefined> = {
        name: contact.name,
        phone: contact.phone,
        email: contact.email,
        company: contact.company,
      };
      return fieldMap[mapping.value] ?? '';
    }
    if (mapping.type === 'custom_field') {
      return customValues.get(mapping.value) ?? '';
    }
    return '';
  }

  const previewText = useMemo(() => {
    const contact = firstContact ?? SAMPLE_CONTACT;
    const customValues = firstContact
      ? firstContactCustomValues
      : new Map<string, string>();

    let text = template.body_text;
    for (const placeholder of bodyPlaceholders) {
      const num = placeholder.replace(/^\{\{|\}\}$/g, '');
      const key = `body_${num}`;
      const mapping = variables[key] ?? variables[num]; 
      const replacement = resolveMappingValue(mapping, contact, customValues) || placeholder;
      text = text.replaceAll(placeholder, replacement);
    }
    return text;
  }, [template.body_text, bodyPlaceholders, variables, firstContact, firstContactCustomValues]);

  const previewHeaderText = useMemo(() => {
    if (template.header_type !== 'text' || !template.header_content) return null;
    const contact = firstContact ?? SAMPLE_CONTACT;
    const customValues = firstContact
      ? firstContactCustomValues
      : new Map<string, string>();

    let text = template.header_content;
    for (const placeholder of headerPlaceholders) {
      const num = placeholder.replace(/^\{\{|\}\}$/g, '');
      const key = `header_${num}`;
      const mapping = variables[key];
      const replacement = resolveMappingValue(mapping, contact, customValues) || placeholder;
      text = text.replaceAll(placeholder, replacement);
    }
    return text;
  }, [template.header_type, template.header_content, headerPlaceholders, variables, firstContact, firstContactCustomValues]);

  const previewLabel = firstContact
    ? firstContact.name || firstContact.phone
    : t('bc.s3.sampleData');

  function renderPlaceholderRow(placeholder: string, key: string, labelPrefix?: string) {
    const mapping = variables[key] ?? { type: 'static', value: '' };

    return (
      <div
        key={key}
        className="rounded-xl border border-border bg-card p-4"
      >
        <div className="mb-3 flex items-center gap-2">
          <span className="inline-flex items-center rounded-md bg-primary/10 px-2 py-0.5 text-xs font-mono font-medium text-primary">
            {placeholder}
          </span>
          {labelPrefix && (
            <span className="text-xs text-muted-foreground font-medium">{labelPrefix}</span>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              {t('bc.s3.mappingType')}
            </label>
            <Select
              value={mapping.type}
              onValueChange={(val) =>
                updateVariable(key, {
                  type: val as VariableType,
                  value: '',
                })
              }
            >
              <SelectTrigger className="w-full border-border bg-muted text-foreground">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="border-border bg-muted">
                <SelectItem value="static">{t('bc.s3.static')}</SelectItem>
                <SelectItem value="field">{t('bc.s3.contactField')}</SelectItem>
                <SelectItem value="custom_field">{t('bc.s3.customField')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              {mapping.type === 'static' ? t('bc.s3.value') : t('bc.s3.field')}
            </label>
            {mapping.type === 'static' ? (
              <Input
                value={mapping.value}
                onChange={(e) =>
                  updateVariable(key, { value: e.target.value })
                }
                placeholder={t('bc.s3.enterValue')}
                className="border-border bg-muted text-foreground placeholder:text-muted-foreground"
              />
            ) : mapping.type === 'field' ? (
              <Select
                value={mapping.value || undefined}
                onValueChange={(val) =>
                  updateVariable(key, { value: val || '' })
                }
              >
                <SelectTrigger className="w-full border-border bg-muted text-foreground">
                  <SelectValue placeholder={t('bc.s3.pickField')} />
                </SelectTrigger>
                <SelectContent className="border-border bg-muted">
                  {contactFields.map((field) => (
                    <SelectItem key={field} value={field}>
                      {t(`bc.s3.fields.${field}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Select
                value={mapping.value || undefined}
                onValueChange={(val) =>
                  updateVariable(key, { value: val || '' })
                }
              >
                <SelectTrigger className="w-full border-border bg-muted text-foreground">
                  <SelectValue
                    placeholder={
                      loadingFields
                        ? t('bc.s3.loading')
                        : customFields.length === 0
                          ? t('bc.s3.noCustomFields')
                          : t('bc.s3.pickCustomField')
                    }
                  />
                </SelectTrigger>
                <SelectContent className="border-border bg-muted">
                  {customFields.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.field_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">{t('bc.s3.title')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('bc.s3.intro')}
        </p>
      </div>

      {!hasAnyPlaceholders ? (
        <div className="rounded-xl border border-border bg-card p-6 text-center">
          <p className="text-sm text-muted-foreground">
            {t('bc.s3.none')}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {headerPlaceholders.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-primary flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-primary" /> {t('bc.s3.header')}
              </h3>
              {headerPlaceholders.map((placeholder: string) => {
                const num = placeholder.replace(/^\{\{|\}\}$/g, '');
                const key = `header_${num}`;
                return renderPlaceholderRow(placeholder, key, headerVariable(num)?.label);
              })}
            </div>
          )}

          {bodyPlaceholders.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-primary flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-primary" /> {t('bc.s3.body')}
              </h3>
              {bodyPlaceholders.map((placeholder: string) => {
                const num = placeholder.replace(/^\{\{|\}\}$/g, '');
                const key = `body_${num}`;
                return renderPlaceholderRow(placeholder, key, bodyVariable(num)?.label);
              })}
            </div>
          )}

          {buttonPlaceholders.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-primary flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-primary" /> {t('bc.s3.buttons')}
              </h3>
              {buttonPlaceholders.map((btn) => {
                const num = btn.placeholder.replace(/^\{\{|\}\}$/g, '');
                const key = `button_${btn.buttonIndex}_${num}`;
                return renderPlaceholderRow(btn.placeholder, key, t('bc.s3.buttonFor', { button: btn.buttonText }));
              })}
            </div>
          )}
        </div>
      )}

      <div className="rounded-xl border border-border bg-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <Eye className="h-4 w-4 text-primary" />
          <p className="text-sm font-medium text-foreground">{t('bc.s3.preview')}</p>
          <span className="text-xs text-muted-foreground">({previewLabel})</span>
          {loadingPreview && (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
          )}
        </div>
        <div className="rounded-lg bg-[#0e1a12] p-3.5 border border-[#1e2d24]">
          <div className="ml-auto max-w-[85%] rounded-2xl bg-[#0b3c2a] text-[#e3fdf5] px-3.5 py-2.5 shadow-sm space-y-1.5">
            {template.header_type === 'text' && previewHeaderText && (
              <p className="font-extrabold text-sm text-white tracking-wide border-b border-[#124d37] pb-1">
                {previewHeaderText}
              </p>
            )}
            {template.header_type && template.header_type !== 'text' && (
              <div className="flex items-center gap-2 bg-[#062c1e] text-xs font-semibold text-teal-700 dark:text-teal-400 p-2 rounded-xl border border-[#0d3c2b]">
                <FileText className="size-4 shrink-0" />
                <span>{t('bc.s3.attachment', { type: template.header_type })}</span>
              </div>
            )}
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-[#c3fae8]">
              {previewText}
            </p>
            {template.footer_text && (
              <p className="text-[10px] text-teal-500/70 italic mt-1 font-medium">
                {template.footer_text}
              </p>
            )}
          </div>
          {template.buttons && Array.isArray(template.buttons) && template.buttons.length > 0 && (
            <div className="ml-auto max-w-[85%] mt-1 space-y-1">
              {template.buttons.map((btn: any, idx: number) => {
                let dynamicUrlSuffix = '';
                const btnUrl = (btn.url ?? btn.value) as string | undefined;
                if ((btn.type === 'URL' || btn.type === 'url') && btnUrl) {
                  const matches = btnUrl.match(/\{\{(\d+)\}\}/g);
                  if (matches) {
                    const contact = firstContact ?? SAMPLE_CONTACT;
                    const customValues = firstContact
                      ? firstContactCustomValues
                      : new Map<string, string>();
                    
                    dynamicUrlSuffix = ' 🔗 ' + btnUrl;
                    matches.forEach((m: string) => {
                      const num = m.replace(/^\{\{|\}\}$/g, '');
                      const key = `button_${idx}_${num}`;
                      const mapping = variables[key];
                      const val = resolveMappingValue(mapping, contact, customValues) || m;
                      dynamicUrlSuffix = dynamicUrlSuffix.replaceAll(m, val);
                    });
                  }
                }
                return (
                  <div
                    key={idx}
                    className="bg-[#1e2f26] border border-[#2b3f33] text-teal-300 rounded-xl py-2 px-3 text-center text-xs font-semibold hover:bg-[#25392e] transition-colors cursor-default"
                  >
                    {btn.text}
                    {dynamicUrlSuffix && (
                      <span className="text-[10px] text-teal-500 block font-normal truncate mt-0.5">
                        {dynamicUrlSuffix}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {unmappedKeys.length > 0 && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
          {t('bc.s3.missing', { list: unmappedKeys.join(', ') })}
        </div>
      )}

      <div className="flex items-center justify-between border-t border-border pt-4">
        <Button
          variant="outline"
          onClick={onBack}
          className="border-border text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('bc.wizard.back')}
        </Button>
        <Button
          onClick={onNext}
          disabled={unmappedKeys.length > 0}
          className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {t('bc.wizard.next')}
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

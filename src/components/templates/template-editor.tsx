'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  AlertTriangle,
  ArrowLeft,
  Bold,
  Braces,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  FileText,
  ImageIcon,
  Italic,
  Loader2,
  Phone,
  Plus,
  Reply,
  Send,
  Strikethrough,
  Trash2,
  Type,
  Upload,
  Video,
  X,
} from 'lucide-react';
import { useI18n } from '@/i18n/client';
import { useWorkspace } from '@/hooks/use-workspace';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  LANGUAGES,
  LIMITS,
  TEMPLATE_SUGGESTIONS,
  VARIABLE_PRESETS,
  defaultVariable,
  draftFromRow,
  draftFromSuggestion,
  draftVariableKeys,
  emptyDraft,
  slugifyName,
  submitErrorKey,
  titleFromName,
  validateDraft,
  variableKey,
  type ButtonType,
  type HeaderType,
  type TemplateButton,
  type TemplateCategory,
  type TemplateDraft,
  type TemplateRow,
  type TemplateVariable,
  type ValidationIssue,
  type VariableSource,
} from '@/lib/templates/model';
import { TemplatePreview } from './template-preview';

const BACK = '/settings?tab=templates';
const CATEGORIES: TemplateCategory[] = ['Marketing', 'Utility', 'Authentication'];
const HEADER_TYPES: HeaderType[] = ['none', 'text', 'image', 'video', 'document'];
const SOURCES: VariableSource[] = ['contact.name', 'contact.phone', 'contact.email', 'contact.company', 'workspace.name', 'manual'];
const MEDIA: Record<'image' | 'video' | 'document', { accept: string; types: string[]; maxMb: number }> = {
  image: { accept: 'image/jpeg,image/png', types: ['image/jpeg', 'image/png'], maxMb: 5 },
  video: { accept: 'video/mp4', types: ['video/mp4'], maxMb: 16 },
  document: { accept: 'application/pdf', types: ['application/pdf'], maxMb: 100 },
};
const HEADER_ICONS: Record<HeaderType, ReactNode> = {
  none: <X className="size-4" aria-hidden />,
  text: <Type className="size-4" aria-hidden />,
  image: <ImageIcon className="size-4" aria-hidden />,
  video: <Video className="size-4" aria-hidden />,
  document: <FileText className="size-4" aria-hidden />,
};
const BUTTON_ICONS: Record<ButtonType, ReactNode> = {
  quick_reply: <Reply className="size-4" aria-hidden />,
  url: <ExternalLink className="size-4" aria-hidden />,
  phone: <Phone className="size-4" aria-hidden />,
};
const HEADER_KEY: Record<HeaderType, string> = { none: 'none', text: 'text', image: 'image', video: 'video', document: 'document' };
const CATEGORY_KEY: Record<TemplateCategory, string> = { Marketing: 'marketing', Utility: 'utility', Authentication: 'authentication' };
const SOURCE_KEY: Record<VariableSource, string> = {
  'contact.name': 'contactName',
  'contact.phone': 'contactPhone',
  'contact.email': 'contactEmail',
  'contact.company': 'contactCompany',
  'workspace.name': 'workspaceName',
  manual: 'manual',
};

interface Channel {
  id: string;
  type: string;
  name: string;
  display_handle?: string | null;
  status: string;
}

interface Fields {
  title: string;
  name: string;
  nameTouched: boolean;
  category: TemplateCategory;
  language: string;
  header: TemplateDraft['header'];
  body: string;
  footer: string;
  buttons: TemplateButton[];
  codeExpiration: number;
}

function fieldsFrom(d: TemplateDraft, title: string): Fields {
  return {
    title,
    name: d.name,
    nameTouched: !!d.name && slugifyName(title) !== d.name,
    category: d.category,
    language: d.language,
    header: d.header,
    body: d.body,
    footer: d.footer ?? '',
    buttons: d.buttons,
    codeExpiration: d.codeExpiration ?? 10,
  };
}

function storeFrom(vars: TemplateVariable[]): Record<string, TemplateVariable> {
  return Object.fromEntries(vars.map((v) => [v.key, v]));
}

/** Small red message under a field. */
function FieldError({ messages, id }: { messages: string[]; id?: string }) {
  if (!messages.length) return null;
  return (
    <ul id={id} className="space-y-0.5" aria-live="polite">
      {messages.map((m) => (
        <li key={m} className="flex items-start gap-1.5 text-xs text-red-500 dark:text-red-400">
          <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
          {m}
        </li>
      ))}
    </ul>
  );
}

function Section({ title, description, children, id }: { title: string; description?: string; children: ReactNode; id?: string }) {
  return (
    <section aria-labelledby={id} className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/40 p-4 sm:p-5">
      <div>
        <h2 id={id} className="text-sm font-semibold text-slate-200">
          {title}
        </h2>
        {description && <p className="mt-0.5 text-xs text-slate-400">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function Counter({ value, max }: { value: number; max: number }) {
  return <span className={cn('text-xs tabular-nums', value > max ? 'font-semibold text-red-500' : 'text-slate-400')}>{`${value}/${max}`}</span>;
}

export function TemplateEditor({ templateId, suggestionId }: { templateId?: string; suggestionId?: string }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const { can, loading: workspaceLoading } = useWorkspace();
  const lang: 'es' | 'en' = locale === 'en' ? 'en' : 'es';
  const defaultLanguage = lang === 'en' ? 'en_US' : 'es';

  const [fields, setFields] = useState<Fields>(() => {
    const s = TEMPLATE_SUGGESTIONS.find((x) => x.id === suggestionId);
    return s ? fieldsFrom(draftFromSuggestion(s, lang, defaultLanguage), s.title[lang]) : fieldsFrom(emptyDraft(defaultLanguage), '');
  });
  const [store, setStore] = useState<Record<string, TemplateVariable>>(() => {
    const s = TEMPLATE_SUGGESTIONS.find((x) => x.id === suggestionId);
    return s ? storeFrom(draftFromSuggestion(s, lang, defaultLanguage).variables) : {};
  });
  const [suggestion, setSuggestion] = useState<string>(suggestionId ?? '');
  const [row, setRow] = useState<TemplateRow | null>(null);
  const [loading, setLoading] = useState(!!templateId);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | undefined>(templateId);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [channelId, setChannelId] = useState<string>('');
  const [advanced, setAdvanced] = useState(false);
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [attempted, setAttempted] = useState(false);
  const [serverIssues, setServerIssues] = useState<ValidationIssue[]>([]);
  const [busy, setBusy] = useState<'save' | 'submit' | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<{ submitted: boolean; error?: string; id: string } | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [customLabel, setCustomLabel] = useState('');
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const selection = useRef<{ start: number; end: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Existing template (edit mode).
  useEffect(() => {
    if (!templateId) return;
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/whatsapp/templates/${templateId}`, { cache: 'no-store' });
        const body = await res.json().catch(() => ({}));
        if (!alive) return;
        if (!res.ok || !body.template) throw new Error(body?.error ?? `HTTP ${res.status}`);
        const r = body.template as TemplateRow;
        const d = draftFromRow(r);
        setRow(r);
        setFields(fieldsFrom(d, titleFromName(r.name)));
        setStore(storeFrom(d.variables));
        if (r.channel_id) setChannelId(r.channel_id);
      } catch (err) {
        if (alive) setLoadError(err instanceof Error ? err.message : String(err));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [templateId]);

  // WhatsApp channels of the workspace (selector only when there are several).
  useEffect(() => {
    let alive = true;
    fetch('/api/channels', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { channels?: Channel[] } | null) => {
        if (!alive || !d) return;
        const wa = (d.channels ?? []).filter((c) => c.type === 'whatsapp');
        setChannels(wa);
        setChannelId((cur) => cur || (wa.find((c) => c.status === 'connected') ?? wa[0])?.id || '');
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const isAuth = fields.category === 'Authentication';
  const nameLocked = !!row?.meta_template_id;
  const readOnly = !!row && (row.status === 'Pending' || row.status === 'Approved');

  const draft: TemplateDraft = useMemo(() => {
    const keys = draftVariableKeys({ header: fields.header, body: fields.body });
    return {
      name: fields.name,
      category: fields.category,
      language: fields.language,
      header: fields.header.type === 'none' ? { type: 'none' } : fields.header,
      body: fields.body,
      footer: fields.footer,
      buttons: fields.buttons,
      variables: keys.map((k) => store[k] ?? defaultVariable(k, lang)),
      codeExpiration: isAuth ? fields.codeExpiration : undefined,
    };
  }, [fields, store, lang, isAuth]);

  const issues = useMemo(() => [...validateDraft(draft), ...serverIssues], [draft, serverIssues]);
  const visible = (field: string) => attempted || touched.has(field);
  const varLabel = (key?: string) => (key ? draft.variables.find((v) => v.key === key)?.label || key : '');
  const issueText = (i: ValidationIssue) => t(`templates.issues.${i.code}`, { detail: i.field === 'variables' ? varLabel(i.detail) : (i.detail ?? '') });
  const messagesFor = (field: ValidationIssue['field'], filter?: (i: ValidationIssue) => boolean) =>
    visible(field) ? issues.filter((i) => i.field === field && (!filter || filter(i))).map(issueText) : [];

  const touch = (field: string) => setTouched((s) => (s.has(field) ? s : new Set(s).add(field)));
  const update = (patch: Partial<Fields>, field?: string) => {
    setFields((f) => ({ ...f, ...patch }));
    if (serverIssues.length) setServerIssues([]);
    if (field) touch(field);
  };
  const setVariable = (key: string, patch: Partial<TemplateVariable>) => {
    setStore((s) => ({ ...s, [key]: { ...(s[key] ?? defaultVariable(key, lang)), ...patch } }));
    touch('variables');
  };

  // ── Title / name ──
  const setTitle = (title: string) => update({ title, ...(fields.nameTouched || nameLocked ? {} : { name: slugifyName(title) }) }, 'name');

  // ── Suggestions ──
  const applySuggestion = (id: string) => {
    const s = TEMPLATE_SUGGESTIONS.find((x) => x.id === id);
    if (!s) return;
    const d = draftFromSuggestion(s, lang, fields.language || defaultLanguage);
    setSuggestion(id);
    setFields((f) => ({ ...fieldsFrom(d, s.title[lang]), ...(nameLocked ? { name: f.name, nameTouched: true } : {}) }));
    setStore((st) => ({ ...st, ...storeFrom(d.variables) }));
    setServerIssues([]);
  };

  // ── Body editing ──
  const rememberSelection = () => {
    const el = bodyRef.current;
    if (el) selection.current = { start: el.selectionStart, end: el.selectionEnd };
  };
  const replaceBody = (next: string, caretStart: number, caretEnd = caretStart) => {
    update({ body: next }, 'body');
    requestAnimationFrame(() => {
      const el = bodyRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(caretStart, caretEnd);
      selection.current = { start: caretStart, end: caretEnd };
    });
  };
  const insertVariable = (v: TemplateVariable) => {
    setStore((s) => (s[v.key] ? s : { ...s, [v.key]: v }));
    const body = fields.body;
    const sel = selection.current ?? { start: body.length, end: body.length };
    const token = `{{${v.key}}}`;
    const before = body.slice(0, sel.start);
    const pad = before && !/\s$/.test(before) ? ' ' : '';
    const next = `${before}${pad}${token}${body.slice(sel.end)}`;
    const caret = before.length + pad.length + token.length;
    replaceBody(next, caret);
  };
  const wrap = (mark: string) => {
    const el = bodyRef.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e, value } = el;
    const next = `${value.slice(0, s)}${mark}${value.slice(s, e)}${mark}${value.slice(e)}`;
    replaceBody(next, s + mark.length, e + mark.length);
  };
  const addCustomVariable = () => {
    const label = customLabel.trim();
    if (!label) return;
    const base = variableKey(label);
    let key = base;
    for (let n = 2; store[key] && store[key].label !== label; n++) key = `${base}_${n}`;
    insertVariable(store[key] ?? { key, label, example: '', source: 'manual' });
    setCustomLabel('');
    setCustomOpen(false);
  };

  // ── Header ──
  const setHeaderType = (type: HeaderType) => {
    if (type === fields.header.type) return;
    update({ header: { type, text: type === 'text' ? (fields.header.text ?? '') : undefined } }, 'header');
  };
  const uploadMedia = async (file: File) => {
    const kind = fields.header.type as 'image' | 'video' | 'document';
    const spec = MEDIA[kind];
    if (!spec) return;
    if (!spec.types.includes(file.type)) {
      toast.error(t(`templates.editor.header.badType.${kind}`));
      return;
    }
    if (file.size > spec.maxMb * 1024 * 1024) {
      toast.error(t('templates.editor.header.tooBig', { max: spec.maxMb }));
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/whatsapp/templates/media', { method: 'POST', body: form });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.url) throw new Error(body?.error ?? `HTTP ${res.status}`);
      update({ header: { type: kind, mediaUrl: body.url as string } }, 'header');
    } catch (err) {
      toast.error(t('templates.editor.header.uploadError'), { description: err instanceof Error ? err.message : undefined });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  // ── Buttons ──
  const count = (type: ButtonType) => fields.buttons.filter((b) => b.type === type).length;
  const canAdd = (type: ButtonType) =>
    fields.buttons.length < LIMITS.buttons && (type === 'url' ? count('url') < 2 : type === 'phone' ? count('phone') < 1 : true);
  const addButton = (type: ButtonType) => update({ buttons: [...fields.buttons, { type, text: '', value: type === 'quick_reply' ? undefined : '' }] }, 'buttons');
  const setButton = (i: number, patch: Partial<TemplateButton>) =>
    update({ buttons: fields.buttons.map((b, k) => (k === i ? { ...b, ...patch } : b)) }, 'buttons');
  const removeButton = (i: number) => update({ buttons: fields.buttons.filter((_, k) => k !== i) }, 'buttons');

  // ── Save / submit ──
  const save = async (submit: boolean) => {
    setAttempted(true);
    const local = validateDraft(draft);
    if (local.length) {
      if (local.some((i) => i.field === 'name')) setAdvanced(true);
      toast.error(t('templates.editor.fixIssues'));
      return;
    }
    setBusy(submit ? 'submit' : 'save');
    try {
      const res = await fetch(savedId ? `/api/whatsapp/templates/${savedId}` : '/api/whatsapp/templates', {
        method: savedId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draft, submit, ...(channelId ? { channel_id: channelId } : {}) }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 422 && Array.isArray(body.issues)) {
        setServerIssues(body.issues as ValidationIssue[]);
        toast.error(t('templates.editor.fixIssues'));
        return;
      }
      if (res.status === 409) {
        setServerIssues([{ field: 'name', code: 'name_taken' }]);
        setAdvanced(true);
        toast.error(t('templates.issues.name_taken'));
        return;
      }
      if (!res.ok || !body.template) throw new Error(body?.error ?? `HTTP ${res.status}`);
      const id = (body.template as TemplateRow).id;
      setSavedId(id);
      setRow(body.template as TemplateRow);
      if (submit) {
        setResult({ submitted: !!body.submitted, error: body.error as string | undefined, id });
      } else {
        toast.success(t('templates.editor.saved'));
        router.push(BACK);
      }
    } catch (err) {
      toast.error(t('templates.editor.saveError'), { description: err instanceof Error ? err.message : undefined });
    } finally {
      setBusy(null);
    }
  };

  const keepEditing = () => {
    const id = result?.id;
    setResult(null);
    if (id && !templateId) router.replace(`/settings/templates/${id}`);
  };

  if (workspaceLoading || loading) {
    return (
      <div className="flex items-center justify-center py-16" role="status" aria-label={t('templates.loading')}>
        <Loader2 className="size-6 animate-spin text-primary" aria-hidden />
      </div>
    );
  }

  const header = (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <Link href={BACK} className="mb-2 inline-flex items-center gap-1.5 rounded text-sm text-slate-400 hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <ArrowLeft className="size-4" aria-hidden /> {t('templates.editor.back')}
        </Link>
        <h1 className="text-xl font-semibold text-white sm:text-2xl">{templateId ? t('templates.editor.editTitle') : t('templates.editor.newTitle')}</h1>
        <p className="mt-1 text-sm text-slate-400">{t('templates.editor.subtitle')}</p>
      </div>
    </div>
  );

  if (!can('admin')) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        {header}
        <p className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 text-sm text-slate-400">{t('templates.adminOnly')}</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        {header}
        <p role="alert" className="rounded-xl border border-red-600/30 bg-red-600/10 p-4 text-sm text-red-500 dark:text-red-400">
          {t('templates.editor.loadError')} ({loadError})
        </p>
      </div>
    );
  }

  const bodyIssues = messagesFor('body');
  const headerIssues = messagesFor('header');
  const nameIssues = visible('name') || fields.name ? issues.filter((i) => i.field === 'name').map(issueText) : [];
  const headerType = fields.header.type;
  const mediaKind = headerType === 'image' || headerType === 'video' || headerType === 'document' ? headerType : null;
  const busyAny = busy !== null || uploading;

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-4">
      {header}

      {readOnly && (
        <p role="status" className="rounded-xl border border-yellow-600/30 bg-yellow-600/10 p-3 text-sm text-yellow-700 dark:text-yellow-400">
          {t('templates.editor.readOnly')}
        </p>
      )}
      {row?.status === 'Rejected' && (
        <div role="status" className="rounded-xl border border-red-600/30 bg-red-600/10 p-3 text-sm text-red-600 dark:text-red-400">
          <p className="font-medium">{t('templates.editor.rejectedTitle')}</p>
          {row.rejection_reason && <p className="mt-0.5">{row.rejection_reason}</p>}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(300px,360px)]">
        <form
          className="min-w-0 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save(true);
          }}
          noValidate
        >
          <fieldset disabled={readOnly} className="min-w-0 space-y-4">
            {/* Start from a suggestion */}
            <Section id="tpl-suggestion" title={t('templates.editor.suggestion.title')} description={t('templates.editor.suggestion.description')}>
              <Select value={suggestion} onValueChange={(v) => v && applySuggestion(String(v))}>
                <SelectTrigger className="w-full" aria-labelledby="tpl-suggestion">
                  <SelectValue>{TEMPLATE_SUGGESTIONS.find((s) => s.id === suggestion)?.title[lang] ?? t('templates.editor.suggestion.placeholder')}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {TEMPLATE_SUGGESTIONS.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.title[lang]} · {t(`templates.category.${CATEGORY_KEY[s.category]}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Section>

            {/* Identity */}
            <Section id="tpl-basics" title={t('templates.editor.basics.title')}>
              <div className="space-y-1.5">
                <Label htmlFor="tpl-title" className="text-slate-200">
                  {t('templates.editor.basics.titleLabel')}
                </Label>
                <Input
                  id="tpl-title"
                  value={fields.title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={t('templates.editor.basics.titlePlaceholder')}
                  aria-describedby="tpl-name-hint"
                  aria-invalid={nameIssues.length > 0 || undefined}
                />
                <div id="tpl-name-hint" className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400">
                  <span>
                    {t('templates.editor.basics.metaName')} <code className="rounded bg-slate-800/60 px-1 py-0.5 font-mono text-slate-200">{fields.name || '—'}</code>
                  </span>
                  {!nameLocked && (
                    <button type="button" onClick={() => setAdvanced((a) => !a)} aria-expanded={advanced} aria-controls="tpl-name-advanced" className="inline-flex items-center gap-0.5 rounded text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      {t('templates.editor.basics.advanced')}
                      <ChevronDown className={cn('size-3.5 transition-transform', advanced && 'rotate-180')} aria-hidden />
                    </button>
                  )}
                  {nameLocked && <span>{t('templates.editor.basics.nameLocked')}</span>}
                </div>
                {advanced && !nameLocked && (
                  <div id="tpl-name-advanced" className="space-y-1.5 pt-1">
                    <Label htmlFor="tpl-name" className="text-slate-200">
                      {t('templates.editor.basics.nameLabel')}
                    </Label>
                    <Input
                      id="tpl-name"
                      value={fields.name}
                      onChange={(e) => update({ name: e.target.value, nameTouched: true }, 'name')}
                      className="font-mono"
                      autoComplete="off"
                      spellCheck={false}
                      aria-invalid={nameIssues.length > 0 || undefined}
                    />
                    <p className="text-xs text-slate-400">{t('templates.editor.basics.nameHelp')}</p>
                  </div>
                )}
                <FieldError messages={nameIssues} />
              </div>

              {channels.length > 1 && (
                <div className="space-y-1.5">
                  <Label htmlFor="tpl-channel" className="text-slate-200">
                    {t('templates.editor.basics.channel')}
                  </Label>
                  <Select value={channelId} onValueChange={(v) => setChannelId(String(v ?? ''))}>
                    <SelectTrigger id="tpl-channel" className="w-full">
                      <SelectValue>{(() => {
                        const c = channels.find((x) => x.id === channelId);
                        return c ? `${c.name}${c.display_handle ? ` · ${c.display_handle}` : ''}` : t('templates.editor.basics.channelPlaceholder');
                      })()}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {channels.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                          {c.display_handle ? ` · ${c.display_handle}` : ''}
                          {c.status !== 'connected' ? ` (${t('templates.editor.basics.channelOff')})` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-slate-400">{t('templates.editor.basics.channelHelp')}</p>
                </div>
              )}

              <div className="space-y-1.5">
                <span id="tpl-category-label" className="text-sm font-medium text-slate-200">
                  {t('templates.editor.basics.category')}
                </span>
                <div role="radiogroup" aria-labelledby="tpl-category-label" className="grid gap-2 sm:grid-cols-3">
                  {CATEGORIES.map((c) => {
                    const on = fields.category === c;
                    return (
                      <button
                        key={c}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => update({ category: c }, 'body')}
                        className={cn(
                          'rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                          on ? 'border-primary bg-primary/10' : 'border-slate-800 hover:border-slate-700 hover:bg-slate-800/40',
                        )}
                      >
                        <span className={cn('block text-sm font-semibold', on ? 'text-primary' : 'text-slate-200')}>{t(`templates.category.${CATEGORY_KEY[c]}`)}</span>
                        <span className="mt-0.5 block text-xs text-slate-400">{t(`templates.editor.basics.categoryHelp.${CATEGORY_KEY[c]}`)}</span>
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-slate-400">{t('templates.editor.basics.reclassify')}</p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="tpl-language" className="text-slate-200">
                  {t('templates.editor.basics.language')}
                </Label>
                <Select value={fields.language} onValueChange={(v) => update({ language: String(v ?? '') }, 'language')}>
                  <SelectTrigger id="tpl-language" className="w-full sm:w-72">
                    <SelectValue>{LANGUAGES.find((l) => l.code === fields.language)?.label ?? fields.language}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {LANGUAGES.map((l) => (
                      <SelectItem key={l.code} value={l.code}>
                        {l.label} <span className="text-muted-foreground">({l.code})</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-slate-400">{t('templates.editor.basics.languageHelp')}</p>
                <FieldError messages={messagesFor('language')} />
              </div>
            </Section>

            {isAuth ? (
              <Section id="tpl-auth" title={t('templates.editor.auth.title')} description={t('templates.editor.auth.description')}>
                <div className="space-y-1.5">
                  <Label htmlFor="tpl-expiration" className="text-slate-200">
                    {t('templates.editor.auth.expiration')}
                  </Label>
                  <Input
                    id="tpl-expiration"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={90}
                    value={fields.codeExpiration}
                    onChange={(e) => update({ codeExpiration: Math.min(90, Math.max(1, Number(e.target.value) || 1)) })}
                    className="w-32"
                  />
                  <p className="text-xs text-slate-400">{t('templates.editor.auth.expirationHelp')}</p>
                </div>
              </Section>
            ) : (
              <>
                {/* Header */}
                <Section id="tpl-header" title={t('templates.editor.header.title')} description={t('templates.editor.header.description')}>
                  <div role="radiogroup" aria-labelledby="tpl-header" className="flex flex-wrap gap-1.5">
                    {HEADER_TYPES.map((h) => {
                      const on = headerType === h;
                      return (
                        <button
                          key={h}
                          type="button"
                          role="radio"
                          aria-checked={on}
                          onClick={() => setHeaderType(h)}
                          className={cn(
                            'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                            on ? 'border-primary bg-primary/10 text-primary' : 'border-slate-800 text-slate-300 hover:bg-slate-800/40',
                          )}
                        >
                          {HEADER_ICONS[h]}
                          {t(`templates.editor.header.types.${HEADER_KEY[h]}`)}
                        </button>
                      );
                    })}
                  </div>

                  {headerType === 'text' && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="tpl-header-text" className="text-slate-200">
                          {t('templates.editor.header.textLabel')}
                        </Label>
                        <Counter value={(fields.header.text ?? '').length} max={LIMITS.headerText} />
                      </div>
                      <Input
                        id="tpl-header-text"
                        value={fields.header.text ?? ''}
                        onChange={(e) => update({ header: { type: 'text', text: e.target.value } }, 'header')}
                        placeholder={t('templates.editor.header.textPlaceholder')}
                        aria-invalid={headerIssues.length > 0 || undefined}
                      />
                      <p className="text-xs text-slate-400">{t('templates.editor.header.textHelp')}</p>
                    </div>
                  )}

                  {mediaKind && (
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-3">
                        {fields.header.mediaUrl && mediaKind === 'image' && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={fields.header.mediaUrl} alt={t('templates.editor.header.sampleAlt')} className="size-16 rounded-md border border-slate-800 object-cover" />
                        )}
                        {fields.header.mediaUrl && mediaKind === 'video' && (
                          <video src={`${fields.header.mediaUrl}#t=0.1`} preload="metadata" muted className="h-16 w-24 rounded-md border border-slate-800 bg-black object-cover" aria-label={t('templates.editor.header.sampleAlt')} />
                        )}
                        {fields.header.mediaUrl && mediaKind === 'document' && (
                          <span className="inline-flex items-center gap-1.5 rounded-md border border-slate-800 px-2.5 py-2 text-xs text-slate-300">
                            <FileText className="size-4" aria-hidden />
                            {decodeURIComponent(fields.header.mediaUrl.split('/').pop() ?? 'PDF')}
                          </span>
                        )}
                        <input
                          ref={fileRef}
                          id="tpl-header-file"
                          type="file"
                          accept={MEDIA[mediaKind].accept}
                          className="sr-only"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) void uploadMedia(f);
                          }}
                        />
                        <Button type="button" variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading}>
                          {uploading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Upload className="size-4" aria-hidden />}
                          {fields.header.mediaUrl ? t('templates.editor.header.replace') : t(`templates.editor.header.upload.${mediaKind}`)}
                        </Button>
                      </div>
                      <p className="text-xs text-slate-400">
                        {t(`templates.editor.header.limits.${mediaKind}`)} {t('templates.editor.header.sampleHelp')}
                      </p>
                    </div>
                  )}
                  <FieldError messages={headerIssues} />
                </Section>

                {/* Body */}
                <Section id="tpl-body" title={t('templates.editor.body.title')} description={t('templates.editor.body.description')}>
                  <div className="space-y-1.5">
                    <div role="toolbar" aria-label={t('templates.editor.body.toolbar')} className="flex flex-wrap items-center gap-1">
                      <DropdownMenu>
                        <DropdownMenuTrigger render={<Button type="button" variant="outline" size="sm" />}>
                          <Braces className="size-3.5" aria-hidden />
                          {t('templates.editor.body.insertVariable')}
                          <ChevronDown className="size-3.5" aria-hidden />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent className="w-60">
                          {VARIABLE_PRESETS.map((p) => (
                            <DropdownMenuItem key={p.key} onClick={() => insertVariable(store[p.key] ?? { key: p.key, label: p.label[lang], example: p.example[lang], source: p.source })}>
                              <span className="truncate">{p.label[lang]}</span>
                            </DropdownMenuItem>
                          ))}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => setCustomOpen(true)}>
                            <Plus className="size-4" aria-hidden />
                            {t('templates.editor.body.customVariable')}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                      <span className="mx-1 h-5 w-px bg-slate-800" aria-hidden />
                      {[
                        { mark: '*', icon: <Bold className="size-4" aria-hidden />, label: t('templates.editor.body.bold') },
                        { mark: '_', icon: <Italic className="size-4" aria-hidden />, label: t('templates.editor.body.italic') },
                        { mark: '~', icon: <Strikethrough className="size-4" aria-hidden />, label: t('templates.editor.body.strike') },
                      ].map((b) => (
                        <Button key={b.mark} type="button" variant="ghost" size="icon-sm" aria-label={b.label} title={b.label} onMouseDown={(e) => e.preventDefault()} onClick={() => wrap(b.mark)}>
                          {b.icon}
                        </Button>
                      ))}
                      <span className="ml-auto">
                        <Counter value={fields.body.length} max={LIMITS.body} />
                      </span>
                    </div>

                    {customOpen && (
                      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-800 p-2.5">
                        <div className="min-w-48 flex-1 space-y-1">
                          <Label htmlFor="tpl-custom-var" className="text-xs text-slate-200">
                            {t('templates.editor.body.customLabel')}
                          </Label>
                          <Input
                            id="tpl-custom-var"
                            autoFocus
                            value={customLabel}
                            onChange={(e) => setCustomLabel(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                addCustomVariable();
                              } else if (e.key === 'Escape') {
                                setCustomOpen(false);
                              }
                            }}
                            placeholder={t('templates.editor.body.customPlaceholder')}
                          />
                        </div>
                        <Button type="button" size="sm" onClick={addCustomVariable} disabled={!customLabel.trim()}>
                          {t('templates.editor.body.customAdd')}
                        </Button>
                        <Button type="button" size="sm" variant="ghost" onClick={() => setCustomOpen(false)}>
                          {t('templates.cancel')}
                        </Button>
                      </div>
                    )}

                    <Label htmlFor="tpl-body-text" className="sr-only">
                      {t('templates.editor.body.title')}
                    </Label>
                    <Textarea
                      id="tpl-body-text"
                      ref={bodyRef}
                      value={fields.body}
                      onChange={(e) => {
                        update({ body: e.target.value }, 'body');
                        selection.current = { start: e.target.selectionStart, end: e.target.selectionEnd };
                      }}
                      onSelect={rememberSelection}
                      onKeyUp={rememberSelection}
                      onClick={rememberSelection}
                      onKeyDown={(e) => {
                        if (!(e.ctrlKey || e.metaKey)) return;
                        const mark = e.key === 'b' ? '*' : e.key === 'i' ? '_' : null;
                        if (mark) {
                          e.preventDefault();
                          wrap(mark);
                        }
                      }}
                      rows={6}
                      placeholder={t('templates.editor.body.placeholder')}
                      className="min-h-36"
                      aria-invalid={bodyIssues.length > 0 || undefined}
                      aria-describedby="tpl-body-help"
                    />
                    <p id="tpl-body-help" className="text-xs text-slate-400">
                      {t('templates.editor.body.help')}
                    </p>
                    <FieldError messages={bodyIssues} />
                  </div>

                  {draft.variables.length > 0 && (
                    <div className="space-y-2 pt-1">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{t('templates.editor.variables.title')}</h3>
                      <p className="text-xs text-slate-400">{t('templates.editor.variables.description')}</p>
                      <ul className="space-y-2">
                        {draft.variables.map((v) => {
                          const vIssues = messagesFor('variables', (i) => i.detail === v.key);
                          return (
                            <li key={v.key} className="rounded-lg border border-slate-800 p-3">
                              <p className="mb-2">
                                <code className="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-xs text-primary">{`{{${v.key}}}`}</code>
                              </p>
                              <div className="grid gap-2 sm:grid-cols-3">
                                <div className="space-y-1">
                                  <Label htmlFor={`var-label-${v.key}`} className="text-xs text-slate-400">
                                    {t('templates.editor.variables.label')}
                                  </Label>
                                  <Input id={`var-label-${v.key}`} value={v.label} onChange={(e) => setVariable(v.key, { label: e.target.value })} />
                                </div>
                                <div className="space-y-1">
                                  <Label htmlFor={`var-example-${v.key}`} className="text-xs text-slate-400">
                                    {t('templates.editor.variables.example')} <span aria-hidden>*</span>
                                  </Label>
                                  <Input
                                    id={`var-example-${v.key}`}
                                    value={v.example}
                                    required
                                    onChange={(e) => setVariable(v.key, { example: e.target.value })}
                                    aria-invalid={vIssues.length > 0 || undefined}
                                  />
                                </div>
                                <div className="space-y-1">
                                  <Label htmlFor={`var-source-${v.key}`} className="text-xs text-slate-400">
                                    {t('templates.editor.variables.source')}
                                  </Label>
                                  <Select value={v.source} onValueChange={(val) => val && setVariable(v.key, { source: val as VariableSource })}>
                                    <SelectTrigger id={`var-source-${v.key}`} className="w-full">
                                      <SelectValue>{t(`templates.sources.${SOURCE_KEY[v.source]}`)}</SelectValue>
                                    </SelectTrigger>
                                    <SelectContent>
                                      {SOURCES.map((s) => (
                                        <SelectItem key={s} value={s}>
                                          {t(`templates.sources.${SOURCE_KEY[s]}`)}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                              </div>
                              <div className="mt-1.5">
                                <FieldError messages={vIssues} />
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                </Section>

                {/* Footer */}
                <Section id="tpl-footer" title={t('templates.editor.footer.title')} description={t('templates.editor.footer.description')}>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="tpl-footer-text" className="text-slate-200">
                        {t('templates.editor.footer.label')}
                      </Label>
                      <Counter value={fields.footer.length} max={LIMITS.footer} />
                    </div>
                    <Input
                      id="tpl-footer-text"
                      value={fields.footer}
                      onChange={(e) => update({ footer: e.target.value }, 'footer')}
                      placeholder={t('templates.editor.footer.placeholder')}
                      aria-invalid={messagesFor('footer').length > 0 || undefined}
                    />
                    <FieldError messages={messagesFor('footer')} />
                  </div>
                </Section>

                {/* Buttons */}
                <Section id="tpl-buttons" title={t('templates.editor.buttons.title')} description={t('templates.editor.buttons.description')}>
                  {fields.buttons.length > 0 && (
                    <ul className="space-y-2">
                      {fields.buttons.map((b, i) => {
                        const dynamic = b.type === 'url' && /\{\{1\}\}$/.test(b.value ?? '');
                        const baseUrl = (b.value ?? '').replace(/\{\{1\}\}$/, '');
                        const bIssues = messagesFor('buttons', (x) => x.detail === b.text && !!x.detail?.length === !!b.text.length);
                        return (
                          <li key={i} className="space-y-2 rounded-lg border border-slate-800 p-3">
                            <div className="flex items-center justify-between gap-2">
                              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-300">
                                {BUTTON_ICONS[b.type]}
                                {t(`templates.editor.buttons.types.${b.type}`)}
                              </span>
                              <Button type="button" variant="ghost" size="icon-sm" onClick={() => removeButton(i)} aria-label={t('templates.editor.buttons.remove', { n: i + 1 })} className="text-slate-400 hover:text-red-400">
                                <Trash2 className="size-4" aria-hidden />
                              </Button>
                            </div>
                            <div className="grid gap-2 sm:grid-cols-2">
                              <div className="space-y-1">
                                <div className="flex items-center justify-between">
                                  <Label htmlFor={`btn-text-${i}`} className="text-xs text-slate-400">
                                    {t('templates.editor.buttons.text')}
                                  </Label>
                                  <Counter value={b.text.length} max={LIMITS.buttonText} />
                                </div>
                                <Input id={`btn-text-${i}`} value={b.text} maxLength={LIMITS.buttonText} onChange={(e) => setButton(i, { text: e.target.value })} />
                              </div>
                              {b.type === 'url' && (
                                <div className="space-y-1">
                                  <Label htmlFor={`btn-url-${i}`} className="text-xs text-slate-400">
                                    {t('templates.editor.buttons.url')}
                                  </Label>
                                  <Input
                                    id={`btn-url-${i}`}
                                    type="url"
                                    inputMode="url"
                                    value={baseUrl}
                                    placeholder="https://"
                                    maxLength={LIMITS.url}
                                    onChange={(e) => setButton(i, { value: `${e.target.value}${dynamic ? '{{1}}' : ''}` })}
                                  />
                                </div>
                              )}
                              {b.type === 'phone' && (
                                <div className="space-y-1">
                                  <Label htmlFor={`btn-phone-${i}`} className="text-xs text-slate-400">
                                    {t('templates.editor.buttons.phone')}
                                  </Label>
                                  <Input id={`btn-phone-${i}`} type="tel" inputMode="tel" value={b.value ?? ''} placeholder="+51 999 999 999" onChange={(e) => setButton(i, { value: e.target.value })} />
                                </div>
                              )}
                            </div>
                            {b.type === 'url' && (
                              <div className="space-y-2">
                                <label className="flex items-center gap-2 text-sm text-slate-300">
                                  <input
                                    type="checkbox"
                                    checked={dynamic}
                                    onChange={(e) => setButton(i, { value: `${baseUrl}${e.target.checked ? '{{1}}' : ''}`, example: e.target.checked ? b.example : undefined })}
                                    className="size-4 accent-[var(--primary)]"
                                  />
                                  {t('templates.editor.buttons.dynamic')}
                                </label>
                                {dynamic && (
                                  <div className="space-y-1">
                                    <Label htmlFor={`btn-example-${i}`} className="text-xs text-slate-400">
                                      {t('templates.editor.buttons.dynamicExample')}
                                    </Label>
                                    <Input id={`btn-example-${i}`} value={b.example ?? ''} placeholder="123" onChange={(e) => setButton(i, { example: e.target.value })} />
                                    <p className="text-xs text-slate-400">
                                      {t('templates.editor.buttons.dynamicHelp', { url: `${baseUrl}${b.example || '…'}` })}
                                    </p>
                                  </div>
                                )}
                              </div>
                            )}
                            <FieldError messages={bIssues} />
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  <DropdownMenu>
                    <DropdownMenuTrigger render={<Button type="button" variant="outline" size="sm" disabled={fields.buttons.length >= LIMITS.buttons} />}>
                      <Plus className="size-4" aria-hidden />
                      {t('templates.editor.buttons.add')}
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="w-56">
                      {(['quick_reply', 'url', 'phone'] as ButtonType[]).map((type) => (
                        <DropdownMenuItem key={type} disabled={!canAdd(type)} onClick={() => addButton(type)}>
                          {BUTTON_ICONS[type]}
                          {t(`templates.editor.buttons.types.${type}`)}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <p className="text-xs text-slate-400">{t('templates.editor.buttons.limits')}</p>
                  <FieldError messages={messagesFor('buttons', (x) => !fields.buttons.some((b) => b.text === x.detail))} />
                </Section>
              </>
            )}
          </fieldset>

          {!readOnly && (
            <div className="sticky bottom-0 z-10 -mx-1 flex flex-col-reverse gap-2 border-t border-slate-800 bg-background/95 px-1 py-3 backdrop-blur sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" onClick={() => void save(false)} disabled={busyAny}>
                {busy === 'save' && <Loader2 className="size-4 animate-spin" aria-hidden />}
                {t('templates.editor.saveDraft')}
              </Button>
              <Button type="submit" disabled={busyAny} className="bg-primary text-primary-foreground hover:bg-primary/90">
                {busy === 'submit' ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Send className="size-4" aria-hidden />}
                {t('templates.editor.submit')}
              </Button>
            </div>
          )}
        </form>

        <aside className="lg:sticky lg:top-4 lg:self-start" aria-label={t('templates.preview.label')}>
          <h2 className="mb-2 text-sm font-semibold text-slate-200">{t('templates.preview.title')}</h2>
          <TemplatePreview draft={draft} />
          <p className="mt-2 text-xs text-slate-400">{t('templates.preview.note')}</p>
        </aside>
      </div>

      <Dialog
        open={!!result}
        onOpenChange={(open) => {
          if (!open && result) {
            if (result.submitted) router.push(BACK);
            else keepEditing();
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {result?.submitted ? <CheckCircle2 className="size-5 text-primary" aria-hidden /> : <AlertTriangle className="size-5 text-red-500" aria-hidden />}
              {result?.submitted ? t('templates.editor.result.successTitle') : t('templates.editor.result.errorTitle')}
            </DialogTitle>
            <DialogDescription>{result?.submitted ? t('templates.editor.result.successBody') : t('templates.editor.result.errorBody')}</DialogDescription>
          </DialogHeader>
          {!result?.submitted && result?.error && (
            <p role="alert" className="rounded-lg border border-red-600/30 bg-red-600/10 p-3 text-sm text-red-600 dark:text-red-400">
              {submitErrorKey(result.error) ? t(submitErrorKey(result.error)!) : result.error}
            </p>
          )}
          <DialogFooter>
            {!result?.submitted && (
              <Button type="button" variant="outline" onClick={keepEditing}>
                {t('templates.editor.result.keepEditing')}
              </Button>
            )}
            <Button type="button" onClick={() => router.push(BACK)}>
              {t('templates.editor.result.back')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, Clock, Loader2, Plus, Send, Trash2 } from 'lucide-react';
import { useT } from '@/i18n/client';
import { useWorkspace } from '@/hooks/use-workspace';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { LoadingBlock } from '@/components/business/shared';
import { TARGETS, type SocialSettings, type Target } from '@/lib/social/model';
import { TargetIcon } from './posts-manager';

interface Loaded {
  settings: SocialSettings;
  whatsapp: { id: string; name: string; display_handle: string | null }[];
}

const selectCls = 'h-8 rounded-lg border border-input bg-background px-2 text-sm';

export function PostsSettings({ connected }: { connected: Set<string> }) {
  const t = useT();
  const { can } = useWorkspace();
  const readOnly = !can('admin');
  const [data, setData] = useState<Loaded | null>(null);
  const [form, setForm] = useState<SocialSettings | null>(null);
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void fetch('/api/social/settings', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((b: Loaded | null) => {
        if (!b) return;
        setData(b);
        setForm(b.settings);
      });
  }, []);

  if (!data || !form) return <LoadingBlock />;

  const set = (patch: Partial<SocialSettings>) => setForm({ ...form, ...patch });
  const setCal = (patch: Partial<SocialSettings['calendar']>) => setForm({ ...form, calendar: { ...form.calendar, ...patch } });

  const save = async () => {
    setSaving(true);
    const res = await fetch('/api/social/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) }).catch(() => null);
    setSaving(false);
    if (!res?.ok) {
      toast.error(t('posts.errors.generic'));
      return;
    }
    const b = (await res.json()) as { settings: SocialSettings };
    setForm(b.settings);
    setData({ ...data, settings: b.settings });
    toast.success(t('posts.settings.saved'));
  };

  const addPhone = () => {
    const d = phone.replace(/\D/g, '');
    if (d.length < 8 || d.length > 15 || form.status_phones.includes(d)) return;
    set({ status_phones: [...form.status_phones, d].slice(0, 5) });
    setPhone('');
  };

  const targetsField = (id: string, value: Target[], onChange: (v: Target[]) => void) => (
    <div className="flex flex-wrap gap-2" role="group" aria-labelledby={id}>
      {TARGETS.map((x) => (
        <label key={x} className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm ${value.includes(x) ? 'border-primary bg-primary/10' : 'border-border'}`}>
          <input
            type="checkbox"
            className="size-4 accent-[var(--primary)]"
            disabled={readOnly}
            checked={value.includes(x)}
            onChange={() => onChange(value.includes(x) ? value.filter((y) => y !== x) : [...value, x])}
          />
          <TargetIcon target={x} className="size-4" />
          {t(`posts.target.${x}`)}
          {x !== 'whatsapp_status' && !connected.has(x) && <span className="text-xs text-muted-foreground">({t('posts.editor.notConnected')})</span>}
        </label>
      ))}
    </div>
  );

  const formatField = (id: string, value: 'post' | 'story', onChange: (v: 'post' | 'story') => void) => (
    <select id={id} className={selectCls} disabled={readOnly} value={value} onChange={(e) => onChange(e.target.value === 'story' ? 'story' : 'post')}>
      <option value="post">{t('posts.format.post')}</option>
      <option value="story">{t('posts.format.story')}</option>
    </select>
  );

  const card = 'space-y-4 rounded-xl border border-border bg-card p-4';

  return (
    <div className="space-y-5">
      {/* Approval + automatic triggers */}
      <section className={card} aria-labelledby="ps-auto">
        <h2 id="ps-auto" className="text-sm font-semibold">{t('posts.settings.approvalTitle')}</h2>
        <fieldset className="space-y-2">
          <legend className="text-sm">{t('posts.settings.approval')}</legend>
          <div className="flex flex-wrap gap-4 text-sm">
            {(['required', 'auto'] as const).map((v) => (
              <label key={v} className="flex items-center gap-2">
                <input type="radio" name="ps-approval" className="size-4 accent-[var(--primary)]" disabled={readOnly} checked={form.approval === v} onChange={() => set({ approval: v })} />
                {v === 'required' ? t('posts.settings.approvalRequired') : t('posts.settings.approvalAuto')}
              </label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{t('posts.settings.approvalHint')}</p>
        </fieldset>
        <div className="flex items-start justify-between gap-4">
          <div>
            <Label htmlFor="ps-new">{t('posts.settings.autoNew')}</Label>
            <p className="text-xs text-muted-foreground">{t('posts.settings.autoNewHint')}</p>
          </div>
          <Switch id="ps-new" checked={form.auto_new_product} disabled={readOnly} onCheckedChange={(v) => set({ auto_new_product: !!v })} />
        </div>
        <div className="flex items-start justify-between gap-4">
          <div>
            <Label htmlFor="ps-restock">{t('posts.settings.autoRestock')}</Label>
            <p className="text-xs text-muted-foreground">{t('posts.settings.autoRestockHint')}</p>
          </div>
          <Switch id="ps-restock" checked={form.auto_restock} disabled={readOnly} onCheckedChange={(v) => set({ auto_restock: !!v })} />
        </div>
        {(form.auto_new_product || form.auto_restock) && (
          <div className="space-y-3 border-l-2 border-border pl-3">
            <div className="space-y-1.5">
              <p id="ps-auto-targets" className="text-sm">{t('posts.settings.autoTargets')}</p>
              {targetsField('ps-auto-targets', form.auto_targets, (v) => set({ auto_targets: v }))}
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="ps-auto-format">{t('posts.settings.autoFormat')}</Label>
              {formatField('ps-auto-format', form.auto_format, (v) => set({ auto_format: v }))}
            </div>
          </div>
        )}
      </section>

      {/* Weekly calendar */}
      <section className={card} aria-labelledby="ps-cal">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="ps-cal" className="text-sm font-semibold">{t('posts.settings.calendarTitle')}</h2>
            <p className="text-xs text-muted-foreground">{t('posts.settings.calendarHint')}</p>
          </div>
          <Switch aria-label={t('posts.settings.calendarEnabled')} checked={form.calendar.enabled} disabled={readOnly} onCheckedChange={(v) => setCal({ enabled: !!v })} />
        </div>
        {form.calendar.enabled && (
          <div className="space-y-3">
            <ul className="space-y-2">
              {form.calendar.slots.map((s, i) => (
                <li key={i} className="flex flex-wrap items-center gap-2">
                  <select
                    aria-label={t('posts.settings.calendarTitle')}
                    className={selectCls}
                    disabled={readOnly}
                    value={s.day}
                    onChange={(e) => setCal({ slots: form.calendar.slots.map((x, j) => (j === i ? { ...x, day: Number(e.target.value) } : x)) })}
                  >
                    {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                      <option key={d} value={d}>{t(`posts.settings.days.${d}`)}</option>
                    ))}
                  </select>
                  <Input
                    type="time"
                    aria-label={t('posts.editor.dateTime')}
                    className="w-32"
                    disabled={readOnly}
                    value={s.time}
                    onChange={(e) => setCal({ slots: form.calendar.slots.map((x, j) => (j === i ? { ...x, time: e.target.value } : x)) })}
                  />
                  {!readOnly && (
                    <Button type="button" size="icon-sm" variant="ghost" aria-label={t('posts.settings.removeSlot')} onClick={() => setCal({ slots: form.calendar.slots.filter((_, j) => j !== i) })}>
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            {!form.calendar.slots.length && <p className="text-xs text-amber-700 dark:text-amber-300">{t('posts.settings.noSlots')}</p>}
            {!readOnly && form.calendar.slots.length < 28 && (
              <Button type="button" size="sm" variant="outline" onClick={() => setCal({ slots: [...form.calendar.slots, { day: 1, time: '19:00' }] })}>
                <Plus className="size-4" aria-hidden /> {t('posts.settings.addSlot')}
              </Button>
            )}
            <div className="space-y-1.5">
              <p id="ps-cal-targets" className="text-sm">{t('posts.settings.calendarTargets')}</p>
              {targetsField('ps-cal-targets', form.calendar.targets, (v) => setCal({ targets: v }))}
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="ps-cal-format">{t('posts.settings.calendarFormat')}</Label>
              {formatField('ps-cal-format', form.calendar.format, (v) => setCal({ format: v }))}
            </div>
          </div>
        )}
      </section>

      {/* WhatsApp status */}
      <section className={card} aria-labelledby="ps-status">
        <div>
          <h2 id="ps-status" className="text-sm font-semibold">{t('posts.settings.statusTitle')}</h2>
          <p className="text-xs text-muted-foreground">{t('posts.settings.statusHint')}</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="ps-phone">{t('posts.settings.statusPhones')}</Label>
          <ul className="flex flex-wrap gap-2">
            {form.status_phones.map((p) => (
              <li key={p} className="flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-sm">
                +{p}
                {!readOnly && (
                  <button type="button" aria-label={t('posts.settings.removeSlot')} onClick={() => set({ status_phones: form.status_phones.filter((x) => x !== p) })} className="rounded-full p-0.5 hover:bg-muted">
                    <Trash2 className="size-3.5" aria-hidden />
                  </button>
                )}
              </li>
            ))}
          </ul>
          {!readOnly && form.status_phones.length < 5 && (
            <div className="flex flex-wrap gap-2">
              <Input
                id="ps-phone"
                inputMode="tel"
                className="w-48"
                placeholder={t('posts.settings.statusPhonesPlaceholder')}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addPhone();
                  }
                }}
              />
              <Button type="button" size="sm" variant="outline" onClick={addPhone}>
                <Plus className="size-4" aria-hidden /> {t('posts.settings.addPhone')}
              </Button>
            </div>
          )}
          <p className="text-xs text-muted-foreground">{t('posts.settings.statusOwnNumber')}</p>
        </div>
        {data.whatsapp.length > 1 && (
          <div className="flex flex-wrap items-center gap-2">
            <Label htmlFor="ps-channel">{t('posts.settings.statusChannel')}</Label>
            <select id="ps-channel" className={selectCls} disabled={readOnly} value={form.status_channel_id ?? ''} onChange={(e) => set({ status_channel_id: e.target.value || null })}>
              <option value="">{t('posts.settings.statusChannelAuto')}</option>
              {data.whatsapp.map((c) => (
                <option key={c.id} value={c.id}>{c.display_handle ? `${c.name} (${c.display_handle})` : c.name}</option>
              ))}
            </select>
          </div>
        )}
        {data.settings.status_phones.length > 0 && <StatusTemplateNotice />}
      </section>

      {/* AI */}
      <section className={card} aria-labelledby="ps-ai">
        <Label id="ps-ai" htmlFor="ps-instructions">{t('posts.settings.instructions')}</Label>
        <Textarea id="ps-instructions" rows={3} maxLength={500} disabled={readOnly} placeholder={t('posts.settings.instructionsPlaceholder')} value={form.caption_instructions} onChange={(e) => set({ caption_instructions: e.target.value })} />
      </section>

      {!readOnly && (
        <div className="flex justify-end">
          <Button type="button" disabled={saving} onClick={() => void save()}>
            {saving && <Loader2 className="size-4 animate-spin" aria-hidden />} {t('posts.settings.save')}
          </Button>
        </div>
      )}
    </div>
  );
}

interface TemplateState {
  template: { id: string; status: string; rejection_reason: string | null } | null;
  whatsapp: boolean;
}

/** "Estado listo para publicar": status and "Send to Meta" while it isn't approved. */
function StatusTemplateNotice() {
  const t = useT();
  const { can } = useWorkspace();
  const [state, setState] = useState<TemplateState | null>(null);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch('/api/social/status-template', { cache: 'no-store' }).catch(() => null);
    if (res?.ok) setState((await res.json()) as TemplateState);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load
    void load();
  }, [load]);

  if (!state?.template) return null;
  const tpl = state.template;
  if (tpl.status === 'Approved') {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <CheckCircle2 className="size-4 text-emerald-500" aria-hidden /> {t('posts.template.title')}: {t('posts.template.approved')}
      </p>
    );
  }
  const submit = async () => {
    setSending(true);
    const res = await fetch(`/api/whatsapp/templates/${tpl.id}/submit`, { method: 'POST' }).catch(() => null);
    const body = await res?.json().catch(() => ({}));
    setSending(false);
    if (res?.ok && body?.submitted) toast.success(t('posts.template.submitted'));
    else toast.error(typeof body?.error === 'string' && body.error.length < 200 ? body.error : t('posts.errors.generic'));
    void load();
  };
  const pending = tpl.status === 'Pending';
  const text = pending ? t('posts.template.pending') : tpl.status === 'Rejected' ? t('posts.template.rejected', { reason: tpl.rejection_reason ?? '—' }) : t('posts.template.draft');
  return (
    <div role="status" className={`space-y-2 rounded-lg border p-3 text-sm ${pending ? 'border-sky-500/40 bg-sky-500/10' : 'border-amber-500/40 bg-amber-500/10'}`}>
      <p className="flex items-start gap-2 font-medium">
        {pending ? <Clock className="mt-0.5 size-4 shrink-0" aria-hidden /> : <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />}
        <span>
          {t('posts.template.title')}
          <span className="block font-normal">{text}</span>
        </span>
      </p>
      <div className="flex flex-wrap items-center gap-2 pl-6">
        {!pending && can('admin') && (
          <Button type="button" size="sm" disabled={sending || !state.whatsapp} onClick={() => void submit()}>
            {sending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Send className="size-4" aria-hidden />} {t('posts.template.submit')}
          </Button>
        )}
        <Link href={`/settings/templates/${tpl.id}`} className="text-xs font-medium underline underline-offset-2">
          {t('posts.template.open')}
        </Link>
        {!pending && !state.whatsapp && <span className="w-full text-xs">{t('posts.template.noWhatsApp')}</span>}
      </div>
    </div>
  );
}

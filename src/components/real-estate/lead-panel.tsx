'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { toast } from 'sonner';
import { BadgeCheck, ExternalLink, Flame, Home, Loader2, Pencil, Send, Snowflake, Sun } from 'lucide-react';
import { useI18n } from '@/i18n/client';
import { useWorkspace } from '@/hooks/use-workspace';
import { createClient } from '@/lib/supabase/client';
import { formatMoney, moneyLocale } from '@/lib/workspace/countries';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { PROPERTY_TYPES, type LeadProfile, type Temperature } from '@/lib/real-estate/leads/types';

interface MatchRow {
  id: string;
  name: string;
  price: number | null;
  /** Effective ISO currency of the price. */
  currency?: string | null;
  image: string | null;
  attributes: Record<string, unknown>;
  url: string;
}

interface Form {
  operation: '' | 'buy' | 'rent';
  zones: string;
  property_types: string[];
  budget_min: string;
  budget_max: string;
  currency: string;
  bedrooms_min: string;
  bathrooms_min: string;
  parking_min: string;
  financing: 'cash' | 'mortgage' | 'unknown';
  mortgage_preapproved: boolean;
  move_in: string;
  purpose: 'live' | 'invest' | 'unknown';
  notes: string;
  alerts_opt_in: boolean;
}

const str = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n));

function toForm(p: LeadProfile | null, currency: string): Form {
  return {
    operation: p?.operation ?? '',
    zones: (p?.zones ?? []).join(', '),
    property_types: p?.property_types ?? [],
    budget_min: str(p?.budget_min),
    budget_max: str(p?.budget_max),
    currency: p?.currency ?? currency,
    bedrooms_min: str(p?.bedrooms_min),
    bathrooms_min: str(p?.bathrooms_min),
    parking_min: str(p?.parking_min),
    financing: p?.financing ?? 'unknown',
    mortgage_preapproved: p?.mortgage_preapproved ?? false,
    move_in: p?.move_in ?? '',
    purpose: p?.purpose ?? 'unknown',
    notes: p?.notes ?? '',
    alerts_opt_in: p?.alerts_opt_in ?? false,
  };
}

const TEMP_STYLE: Record<Temperature, { cls: string; Icon: typeof Flame }> = {
  hot: { cls: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200', Icon: Flame },
  warm: { cls: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200', Icon: Sun },
  cold: { cls: 'bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200', Icon: Snowflake },
};

const selectClass =
  'h-8 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60';

export interface LeadPanelProps {
  contactId: string | null | undefined;
  conversationId?: string | null;
  className?: string;
}

/**
 * Real-estate lead block for the inbox sidebar: what the customer is
 * looking for (filled by the AI, editable), score / temperature, and the
 * best matching listings with "send to chat".
 */
export function LeadPanel({ contactId, conversationId, className }: LeadPanelProps) {
  const { t, locale } = useI18n();
  const { workspace } = useWorkspace();
  const uid = useId();
  const wsCurrency = workspace?.currency || 'PEN';
  const [profile, setProfile] = useState<LeadProfile | null | undefined>(undefined);
  const [matches, setMatches] = useState<MatchRow[] | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Form>(() => toForm(null, wsCurrency));
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!contactId) return;
    try {
      const [p, m] = await Promise.all([
        fetch(`/api/real-estate/leads/${contactId}`, { cache: 'no-store' }),
        fetch(`/api/real-estate/leads/${contactId}/matches`, { cache: 'no-store' }),
      ]);
      const pd = await p.json();
      const md = await m.json();
      if (!p.ok) throw new Error(pd?.error);
      setProfile(pd.profile ?? null);
      setMatches(m.ok ? (md.matches ?? []) : []);
    } catch {
      setProfile(null);
      setMatches([]);
    }
  }, [contactId]);

  useEffect(() => {
    setProfile(undefined);
    setMatches(null);
    setEditing(false);
    void load();
  }, [load]);

  // The AI updates the profile while the chat goes on: refresh live.
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });
  useEffect(() => {
    if (!contactId || !workspace?.id) return;
    const db = createClient();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const channel = db
      .channel(`lead-panel:${contactId}:${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lead_profiles', filter: `contact_id=eq.${contactId}` }, () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => void loadRef.current(), 400);
      })
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      db.removeChannel(channel);
    };
  }, [contactId, workspace?.id]);

  if (!contactId) return null;

  const money = (n: number, cur?: string | null) => formatMoney(n, cur || wsCurrency, moneyLocale({ locale, country: workspace?.country ?? null }));

  const startEdit = () => {
    setForm(toForm(profile ?? null, wsCurrency));
    setEditing(true);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const num = (s: string) => (s.trim() === '' ? null : Number(s));
    setSaving(true);
    try {
      const res = await fetch(`/api/real-estate/leads/${contactId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversation_id: conversationId ?? undefined,
          operation: form.operation || null,
          zones: form.zones.split(',').map((z) => z.trim()).filter(Boolean),
          property_types: form.property_types,
          budget_min: num(form.budget_min),
          budget_max: num(form.budget_max),
          currency: form.currency || null,
          bedrooms_min: num(form.bedrooms_min),
          bathrooms_min: num(form.bathrooms_min),
          parking_min: num(form.parking_min),
          financing: form.financing,
          mortgage_preapproved: form.mortgage_preapproved,
          move_in: form.move_in.trim() || null,
          purpose: form.purpose,
          notes: form.notes.trim() || null,
          alerts_opt_in: form.alerts_opt_in,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error);
      toast.success(data.qualified ? t('leads.panel.savedQualified') : t('leads.panel.saved'));
      setEditing(false);
      await load();
    } catch {
      toast.error(t('leads.panel.errors.save'));
    } finally {
      setSaving(false);
    }
  };

  const send = async (m: MatchRow) => {
    if (!conversationId) return;
    setSending(m.id);
    try {
      const res = await fetch(`/api/real-estate/leads/${contactId}/matches`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: m.id, conversation_id: conversationId }),
      });
      if (!res.ok) throw new Error();
      toast.success(t('leads.panel.sent', { name: m.name }));
    } catch {
      toast.error(t('leads.panel.errors.send'));
    } finally {
      setSending(null);
    }
  };

  const sectionTitle = 'flex items-center justify-between gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground';
  const p = profile;
  const temp = p ? TEMP_STYLE[p.temperature] : null;

  const facts: [string, string][] = p
    ? (
        [
          [t('leads.fields.operation'), p.operation ? t(`leads.operation.${p.operation}`) : ''],
          [t('leads.fields.zones'), p.zones.join(', ')],
          [t('leads.fields.propertyTypes'), p.property_types.map((x) => (PROPERTY_TYPES as readonly string[]).includes(x) ? t(`leads.propertyType.${x}`) : x).join(', ')],
          [
            t('leads.fields.budget'),
            p.budget_min && p.budget_max
              ? `${money(p.budget_min, p.currency)} – ${money(p.budget_max, p.currency)}`
              : p.budget_max
                ? t('leads.routing.upTo', { amount: money(p.budget_max, p.currency) })
                : p.budget_min
                  ? t('leads.routing.from', { amount: money(p.budget_min, p.currency) })
                  : '',
          ],
          [t('leads.fields.bedroomsMin'), str(p.bedrooms_min)],
          [t('leads.fields.financing'), p.financing !== 'unknown' ? `${t(`leads.financing.${p.financing}`)}${p.mortgage_preapproved ? ` · ${t('leads.fields.preapproved')}` : ''}` : ''],
          [t('leads.fields.moveIn'), p.move_in ?? ''],
          [t('leads.fields.purpose'), p.purpose !== 'unknown' ? t(`leads.purpose.${p.purpose}`) : ''],
          [t('leads.fields.notes'), p.notes ?? ''],
        ] as [string, string][]
      ).filter(([, v]) => !!v)
    : [];

  return (
    <div className={cn('grid gap-4 text-sm', className)}>
      <section aria-labelledby={`${uid}-lead`} className="grid gap-2">
        <div className={sectionTitle}>
          <h3 id={`${uid}-lead`} className="flex items-center gap-1.5">
            <Home aria-hidden className="size-3.5" />
            {t('leads.panel.title')}
          </h3>
          {!editing && profile !== undefined && (
            <Button type="button" variant="ghost" size="xs" onClick={startEdit} aria-label={t('leads.panel.editLabel')}>
              <Pencil className="size-3" aria-hidden="true" />
              {t('leads.panel.edit')}
            </Button>
          )}
        </div>

        {profile === undefined ? (
          <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label={t('leads.common.loading')} />
        ) : editing ? (
          <form onSubmit={save} className="grid gap-2 rounded-lg border border-border bg-card p-2">
            <div className="grid grid-cols-2 gap-2">
              <div className="grid gap-1">
                <Label htmlFor={`${uid}-op`} className="text-xs">{t('leads.fields.operation')}</Label>
                <select id={`${uid}-op`} className={selectClass} value={form.operation} onChange={(e) => setForm({ ...form, operation: e.target.value as Form['operation'] })}>
                  <option value="">—</option>
                  <option value="buy">{t('leads.operation.buy')}</option>
                  <option value="rent">{t('leads.operation.rent')}</option>
                </select>
              </div>
              <div className="grid gap-1">
                <Label htmlFor={`${uid}-zones`} className="text-xs">{t('leads.fields.zones')}</Label>
                <Input id={`${uid}-zones`} className="h-8" value={form.zones} onChange={(e) => setForm({ ...form, zones: e.target.value })} placeholder={t('leads.routing.zonesPlaceholder')} />
              </div>
              <div className="grid gap-1">
                <Label htmlFor={`${uid}-bmin`} className="text-xs">{t('leads.fields.budgetMin')}</Label>
                <Input id={`${uid}-bmin`} className="h-8" type="number" min={0} inputMode="decimal" value={form.budget_min} onChange={(e) => setForm({ ...form, budget_min: e.target.value })} />
              </div>
              <div className="grid gap-1">
                <Label htmlFor={`${uid}-bmax`} className="text-xs">{t('leads.fields.budgetMax')}</Label>
                <Input id={`${uid}-bmax`} className="h-8" type="number" min={0} inputMode="decimal" value={form.budget_max} onChange={(e) => setForm({ ...form, budget_max: e.target.value })} />
              </div>
              <div className="grid gap-1">
                <Label htmlFor={`${uid}-cur`} className="text-xs">{t('leads.fields.currency')}</Label>
                <Input id={`${uid}-cur`} className="h-8 uppercase" maxLength={3} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })} />
              </div>
              <div className="grid gap-1">
                <Label htmlFor={`${uid}-beds`} className="text-xs">{t('leads.fields.bedroomsMin')}</Label>
                <Input id={`${uid}-beds`} className="h-8" type="number" min={0} max={50} value={form.bedrooms_min} onChange={(e) => setForm({ ...form, bedrooms_min: e.target.value })} />
              </div>
              <div className="grid gap-1">
                <Label htmlFor={`${uid}-baths`} className="text-xs">{t('leads.fields.bathroomsMin')}</Label>
                <Input id={`${uid}-baths`} className="h-8" type="number" min={0} max={50} value={form.bathrooms_min} onChange={(e) => setForm({ ...form, bathrooms_min: e.target.value })} />
              </div>
              <div className="grid gap-1">
                <Label htmlFor={`${uid}-park`} className="text-xs">{t('leads.fields.parkingMin')}</Label>
                <Input id={`${uid}-park`} className="h-8" type="number" min={0} max={50} value={form.parking_min} onChange={(e) => setForm({ ...form, parking_min: e.target.value })} />
              </div>
              <div className="grid gap-1">
                <Label htmlFor={`${uid}-fin`} className="text-xs">{t('leads.fields.financing')}</Label>
                <select id={`${uid}-fin`} className={selectClass} value={form.financing} onChange={(e) => setForm({ ...form, financing: e.target.value as Form['financing'] })}>
                  <option value="unknown">{t('leads.financing.unknown')}</option>
                  <option value="cash">{t('leads.financing.cash')}</option>
                  <option value="mortgage">{t('leads.financing.mortgage')}</option>
                </select>
              </div>
              <div className="grid gap-1">
                <Label htmlFor={`${uid}-purpose`} className="text-xs">{t('leads.fields.purpose')}</Label>
                <select id={`${uid}-purpose`} className={selectClass} value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value as Form['purpose'] })}>
                  <option value="unknown">{t('leads.purpose.unknown')}</option>
                  <option value="live">{t('leads.purpose.live')}</option>
                  <option value="invest">{t('leads.purpose.invest')}</option>
                </select>
              </div>
              <div className="col-span-2 grid gap-1">
                <Label htmlFor={`${uid}-move`} className="text-xs">{t('leads.fields.moveIn')}</Label>
                <Input id={`${uid}-move`} className="h-8" maxLength={120} value={form.move_in} onChange={(e) => setForm({ ...form, move_in: e.target.value })} placeholder={t('leads.fields.moveInPlaceholder')} />
              </div>
            </div>
            <fieldset className="grid gap-1">
              <legend className="mb-1 text-xs font-medium text-foreground">{t('leads.fields.propertyTypes')}</legend>
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {PROPERTY_TYPES.map((pt) => (
                  <label key={pt} className="flex items-center gap-1.5 text-xs text-foreground">
                    <input
                      type="checkbox"
                      className="size-4 accent-[var(--primary)]"
                      checked={form.property_types.includes(pt)}
                      onChange={(e) =>
                        setForm({ ...form, property_types: e.target.checked ? [...form.property_types, pt] : form.property_types.filter((x) => x !== pt) })
                      }
                    />
                    {t(`leads.propertyType.${pt}`)}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="flex items-center gap-2 text-xs text-foreground">
              <input
                type="checkbox"
                className="size-4 accent-[var(--primary)]"
                checked={form.mortgage_preapproved}
                onChange={(e) => setForm({ ...form, mortgage_preapproved: e.target.checked })}
              />
              {t('leads.fields.preapproved')}
            </label>
            <label className="flex items-center gap-2 text-xs text-foreground">
              <Switch checked={form.alerts_opt_in} onCheckedChange={(v) => setForm({ ...form, alerts_opt_in: v === true })} aria-label={t('leads.fields.alerts')} />
              {t('leads.fields.alerts')}
            </label>
            <div className="grid gap-1">
              <Label htmlFor={`${uid}-notes`} className="text-xs">{t('leads.fields.notes')}</Label>
              <Textarea id={`${uid}-notes`} rows={2} maxLength={2000} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setEditing(false)}>
                {t('leads.common.cancel')}
              </Button>
              <Button type="submit" size="sm" disabled={saving}>
                {saving && <Loader2 className="animate-spin" aria-hidden="true" />}
                {t('leads.common.save')}
              </Button>
            </div>
          </form>
        ) : !p ? (
          <p className="text-xs text-muted-foreground">{t('leads.panel.empty')}</p>
        ) : (
          <div className="grid gap-2 rounded-lg border border-border bg-card p-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span
                className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-foreground tabular-nums"
                title={t('leads.panel.scoreHelp')}
              >
                {t('leads.panel.score', { score: p.score })}
              </span>
              {temp && (
                <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', temp.cls)}>
                  <temp.Icon className="size-3" aria-hidden="true" />
                  {t(`leads.temperature.${p.temperature}`)}
                </span>
              )}
              {p.qualified_at && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
                  <BadgeCheck className="size-3" aria-hidden="true" />
                  {t('leads.panel.qualified')}
                </span>
              )}
              {p.alerts_opt_in && <span className="text-xs text-muted-foreground">{t('leads.panel.alertsOn')}</span>}
            </div>
            {facts.length ? (
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
                {facts.map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd className="break-words text-foreground">{v}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-xs text-muted-foreground">{t('leads.panel.noFacts')}</p>
            )}
            <p className="text-[11px] text-muted-foreground">{p.updated_by === 'ai' ? t('leads.panel.byAi') : t('leads.panel.byTeam')}</p>
          </div>
        )}
      </section>

      <section aria-labelledby={`${uid}-matches`} className="grid gap-2">
        <div className={sectionTitle}>
          <h3 id={`${uid}-matches`}>
            {t('leads.panel.matches')}
            {matches && matches.length > 0 && <span className="ml-1 tabular-nums">({matches.length})</span>}
          </h3>
        </div>
        {matches === null ? (
          <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label={t('leads.common.loading')} />
        ) : matches.length === 0 ? (
          <p className="text-xs text-muted-foreground">{p ? t('leads.panel.noMatches') : t('leads.panel.matchesNeedProfile')}</p>
        ) : (
          <ul className="grid gap-1.5">
            {matches.map((m) => {
              const zone = typeof m.attributes.zone === 'string' ? m.attributes.zone : '';
              const beds = Number(m.attributes.bedrooms);
              return (
                <li key={m.id} className="flex items-center gap-2 rounded-lg border border-border bg-card p-1.5">
                  {m.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.image} alt="" className="size-12 shrink-0 rounded-md object-cover" loading="lazy" />
                  ) : (
                    <div className="flex size-12 shrink-0 items-center justify-center rounded-md bg-muted" aria-hidden="true">
                      <Home className="size-5 text-muted-foreground" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <a href={m.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 truncate text-xs font-medium text-foreground underline-offset-2 hover:underline">
                      <span className="truncate">{m.name}</span>
                      <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
                      <span className="sr-only">{t('leads.panel.opensNewTab')}</span>
                    </a>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {[m.price === null ? t('leads.panel.priceOnRequest') : money(m.price, m.currency), zone, Number.isFinite(beds) && beds > 0 ? t('leads.panel.beds', { count: beds }) : '']
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>
                  {conversationId && (
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      disabled={sending === m.id}
                      onClick={() => void send(m)}
                      aria-label={t('leads.panel.sendLabel', { name: m.name })}
                      title={t('leads.panel.send')}
                    >
                      {sending === m.id ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Send aria-hidden="true" />}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

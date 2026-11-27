'use client';

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { toast } from 'sonner';
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Building2,
  Check,
  Clock,
  HelpCircle,
  Loader2,
  MapPin,
  Package,
  PartyPopper,
  Plus,
  Sparkles,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import { useI18n } from '@/i18n/client';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspace } from '@/hooks/use-workspace';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { getPreset, PRESETS, type ModuleKey } from '@/lib/industries';
import { agentFromTemplate, templatesFor, type TemplateKey } from '@/lib/agents/templates';
import { AGENT_TONES } from '@/components/agents/types';
import { api } from '@/components/business/api';
import { selectClass } from '@/components/business/shared';
import { onboardingState, wizardDue, WIZARD_STEPS, type WizardStep } from '@/lib/workspace/onboarding';

// Setup wizard after signup: the business, contact, hours, what it sells,
// FAQs and the AI agent, one step at a time. Each "Next" saves its step, so
// closing halfway loses nothing; "I'll set it up later" skips it (it can be
// opened again from the dashboard's setup checklist).

const ICONS: Record<WizardStep, LucideIcon> = {
  business: Building2,
  contact: MapPin,
  hours: Clock,
  catalog: Package,
  faqs: HelpCircle,
  agent: Bot,
  done: PartyPopper,
};

const MODULE_KEYS: ModuleKey[] = ['bookings', 'staff', 'services', 'products', 'orders', 'triage'];

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;
type Day = (typeof DAYS)[number];
interface DayHours {
  day_name: Day;
  is_closed: boolean;
  opening_time: string;
  closing_time: string;
}
const DEFAULT_HOURS: DayHours[] = DAYS.map((d) => ({
  day_name: d,
  is_closed: d === 'Sunday',
  opening_time: '09:00',
  closing_time: d === 'Saturday' ? '13:00' : '18:00',
}));

interface ItemRow {
  name: string;
  price: string;
  duration: string;
}
interface FaqRow {
  q: string;
  a: string;
}
const emptyItem = (): ItemRow => ({ name: '', price: '', duration: '30' });

function browserZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

const SetupWizardContext = createContext<{ open: () => void } | null>(null);

/** Opens the setup wizard (the dashboard's setup checklist uses it). */
export function useSetupWizard() {
  return useContext(SetupWizardContext);
}

export function SetupWizardProvider({ children }: { children: ReactNode }) {
  const { workspace, role } = useWorkspace();
  const { impersonating, profile } = useAuth();
  const [open, setOpen] = useState(false);
  const autoOpened = useRef<string | null>(null);
  const due = !!workspace && !impersonating && !profile?.is_platform_admin && wizardDue(workspace.settings, role);

  useEffect(() => {
    if (!due || !workspace || autoOpened.current === workspace.id) return;
    autoOpened.current = workspace.id;
    const timer = setTimeout(() => setOpen(true), 500);
    return () => clearTimeout(timer);
  }, [due, workspace]);

  const value = useMemo(() => ({ open: () => setOpen(true) }), []);
  return (
    <SetupWizardContext.Provider value={value}>
      {children}
      {open && workspace && <SetupWizard onClose={() => setOpen(false)} />}
    </SetupWizardContext.Provider>
  );
}

function SetupWizard({ onClose }: { onClose: () => void }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const { workspace, modules, refresh } = useWorkspace();
  const lang = locale === 'en' ? 'en' : 'es';
  const ws = workspace!;
  const saved = onboardingState(ws.settings);
  const [step, setStep] = useState(saved.status === 'pending' ? saved.step : 0);
  const [busy, setBusy] = useState(false);
  const total = WIZARD_STEPS.length;
  const key = WIZARD_STEPS[step];
  const w = (k: string, v?: Record<string, string | number>) => t(`business.wizard.${k}`, v);

  // Step 1–2: the business and how to reach it.
  const [biz, setBiz] = useState({
    name: ws.name ?? '',
    industry: ws.industry || 'generic',
    business_type_detail: ws.business_type_detail ?? '',
    description: ws.description ?? '',
  });
  // Module switches on top of the chosen type's recommended ones (a new type starts from its own).
  const [moduleOverrides, setModuleOverrides] = useState<Record<string, boolean>>(() => ({ ...((ws.settings?.modules as Record<string, boolean> | undefined) ?? {}) }));
  const preset = getPreset(biz.industry);
  const moduleOn = (k: ModuleKey) => (typeof moduleOverrides[k] === 'boolean' ? moduleOverrides[k] : preset.modules[k]);
  const [contact, setContact] = useState({
    phone: ws.phone ?? '',
    email: ws.email ?? '',
    website: ws.website ?? '',
    address: ws.address ?? '',
    city: ws.city ?? '',
    google_map_link: ws.google_map_link ?? '',
    timezone: ws.timezone && ws.timezone !== 'UTC' ? ws.timezone : browserZone(),
  });
  // Step 3–6: loaded from what the business already has.
  const [hours, setHours] = useState<DayHours[]>(DEFAULT_HOURS);
  const [items, setItems] = useState<ItemRow[]>([emptyItem(), emptyItem(), emptyItem()]);
  const [faqs, setFaqs] = useState<FaqRow[]>([{ q: '', a: '' }, { q: '', a: '' }, { q: '', a: '' }]);
  const [counts, setCounts] = useState({ services: 0, products: 0, faqs: 0 });
  const [agentId, setAgentId] = useState<string | null>(null);
  const [template, setTemplate] = useState<TemplateKey | null>(null);
  const [agent, setAgent] = useState({ name: '', tone: 'friendly', greeting_message: '', instructions: '' });
  const [done, setDone] = useState<Record<string, boolean>>({});

  const agentOptions = templatesFor(biz.industry, { bookings: modules.bookings, products: modules.products, orders: modules.orders }).filter((o) => o.key !== 'blank');
  const catalogKind: 'services' | 'products' | null = modules.services ? 'services' : modules.products ? 'products' : null;

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [h, s, p, f, a] = await Promise.all([
        api<{ hours: (DayHours & { opening_time: string; closing_time: string })[] }>('/api/business/hours').catch(() => null),
        api<{ services: unknown[] }>('/api/business/services').catch(() => null),
        api<{ total: number }>('/api/catalog/products?limit=1').catch(() => null),
        api<{ faqs: unknown[] }>('/api/business/faqs').catch(() => null),
        api<{ agents: { id: string; name: string; tone: string | null; greeting_message: string | null; instructions: string | null }[] }>('/api/agents').catch(() => null),
      ]);
      if (!alive) return;
      if (h?.hours?.length) {
        setHours(
          DAYS.map((d) => {
            const r = h.hours.find((x) => x.day_name === d);
            return r ? { day_name: d, is_closed: r.is_closed, opening_time: r.opening_time.slice(0, 5), closing_time: r.closing_time.slice(0, 5) } : DEFAULT_HOURS.find((x) => x.day_name === d)!;
          }),
        );
      }
      setCounts({ services: s?.services?.length ?? 0, products: p?.total ?? 0, faqs: f?.faqs?.length ?? 0 });
      const first = a?.agents?.[0];
      if (first) {
        setAgentId(first.id);
        setAgent({ name: first.name, tone: first.tone ?? 'friendly', greeting_message: first.greeting_message ?? '', instructions: first.instructions ?? '' });
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // The first template of the business type until the owner picks another.
  useEffect(() => {
    if (agentId || template || !agentOptions.length) return;
    const tpl = agentOptions[0];
    // eslint-disable-next-line react-hooks/set-state-in-effect -- default template once the agent list is known
    setTemplate(tpl.key);
    setAgent((a) => ({ ...a, name: a.name || tpl.text[lang].name, tone: tpl.tone, greeting_message: a.greeting_message || tpl.text[lang].greeting || '' }));
  }, [agentId, template, agentOptions, lang]);

  const progress = (body: Record<string, unknown>) => fetch('/api/business/onboarding', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null);

  /** Saves the current step; false keeps the wizard on it. */
  const saveStep = async (): Promise<boolean> => {
    switch (key) {
      case 'business': {
        if (!biz.name.trim()) {
          toast.error(w('business.nameRequired'));
          return false;
        }
        // Only the switches that differ from the type's recommendation are stored.
        const mods: Record<string, boolean> = {};
        for (const k of MODULE_KEYS) if (moduleOn(k) !== preset.modules[k]) mods[k] = moduleOn(k);
        await api('/api/business/workspace', {
          method: 'PATCH',
          body: {
            name: biz.name.trim(),
            business_type_detail: biz.business_type_detail,
            description: biz.description,
            industry: biz.industry,
            settings: { modules: mods },
          },
        });
        await refresh();
        return true;
      }
      case 'contact': {
        try {
          new Intl.DateTimeFormat('en-US', { timeZone: contact.timezone.trim() || 'UTC' });
        } catch {
          toast.error(w('contact.invalidTimezone'));
          return false;
        }
        await api('/api/business/workspace', { method: 'PATCH', body: { ...contact, timezone: contact.timezone.trim() || 'UTC' } });
        return true;
      }
      case 'hours': {
        if (hours.some((h) => !h.is_closed && h.closing_time <= h.opening_time)) {
          toast.error(w('hours.invalid'));
          return false;
        }
        await api('/api/business/hours', { method: 'PUT', body: { hours: hours.map((h) => ({ ...h, break_start: null, break_end: null })) } });
        return true;
      }
      case 'catalog': {
        const rows = items.filter((r) => r.name.trim());
        const price = (v: string) => {
          const n = Number(v.replace(',', '.'));
          return v.trim() && Number.isFinite(n) && n >= 0 ? n : null;
        };
        for (const r of rows) {
          if (catalogKind === 'services') {
            const minutes = Math.round(Number(r.duration));
            await api('/api/business/services', {
              method: 'POST',
              body: { name: r.name.trim(), price: price(r.price), ...(minutes > 0 ? { duration_minutes: Math.min(Math.max(minutes, 5), 1440) } : {}) },
            });
          } else if (catalogKind === 'products') {
            await api('/api/catalog/products', { method: 'POST', body: { product: { name: r.name.trim(), price: price(r.price), images: [], tags: [] }, variants: [] } });
          }
        }
        if (rows.length && catalogKind) {
          setCounts((c) => ({ ...c, [catalogKind]: c[catalogKind] + rows.length }));
          setItems([emptyItem(), emptyItem(), emptyItem()]);
        }
        return true;
      }
      case 'faqs': {
        const rows = faqs.filter((r) => r.q.trim() && r.a.trim());
        for (const r of rows) await api('/api/business/faqs', { method: 'POST', body: { question: r.q.trim(), answer: r.a.trim() } });
        if (rows.length) {
          setCounts((c) => ({ ...c, faqs: c.faqs + rows.length }));
          setFaqs([{ q: '', a: '' }, { q: '', a: '' }, { q: '', a: '' }]);
        }
        return true;
      }
      case 'agent': {
        if (!agent.name.trim()) {
          toast.error(w('agent.nameRequired'));
          return false;
        }
        const fields = {
          name: agent.name.trim(),
          tone: agent.tone,
          greeting_message: agent.greeting_message.trim() || null,
          instructions: agent.instructions.trim() || null,
        };
        if (agentId) {
          await api(`/api/agents/${agentId}`, { method: 'PATCH', body: fields });
        } else {
          const tpl = agentOptions.find((o) => o.key === template) ?? agentOptions[0];
          const base = tpl ? agentFromTemplate(tpl, lang, { bookings: modules.bookings, products: modules.products, orders: modules.orders }) : { language: 'auto', enabled: true };
          const res = await api<{ agent: { id: string } }>('/api/agents', { method: 'POST', body: { ...base, ...fields } });
          setAgentId(res.agent.id);
        }
        return true;
      }
      default:
        return true;
    }
  };

  const next = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (!(await saveStep())) return;
      setDone((d) => ({ ...d, [key]: true }));
      const to = Math.min(step + 1, total - 1);
      void progress({ step: to });
      setStep(to);
    } catch (err) {
      console.error('[setup-wizard] save failed:', err instanceof Error ? err.message : err);
      toast.error(w('errors.generic'));
    } finally {
      setBusy(false);
    }
  };

  const close = async (status: 'done' | 'skipped', to?: string) => {
    onClose();
    await progress({ status });
    await refresh();
    if (to) router.push(to);
  };

  const shell = (
    <div className="flex h-full min-h-0 flex-col">
      {/* Step list on the left (desktop), progress bar on top (mobile) */}
      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-56 shrink-0 flex-col gap-1 border-r border-border bg-muted/40 p-5 md:flex">
          <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
            <Sparkles className="size-4 text-primary" aria-hidden /> {w('title')}
          </p>
          <ol className="space-y-1">
            {WIZARD_STEPS.map((s, i) => {
              const Icon = ICONS[s];
              const current = i === step;
              const passed = i < step;
              return (
                <li key={s}>
                  <button
                    type="button"
                    disabled={i > step || busy}
                    onClick={() => setStep(i)}
                    aria-current={current ? 'step' : undefined}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors disabled:cursor-default',
                      current ? 'bg-primary/10 font-medium text-primary' : passed ? 'text-foreground hover:bg-muted' : 'text-muted-foreground',
                    )}
                  >
                    <span
                      className={cn(
                        'flex size-6 shrink-0 items-center justify-center rounded-full text-xs',
                        current ? 'bg-primary text-primary-foreground' : passed ? 'bg-emerald-500 text-white' : 'bg-muted text-muted-foreground',
                      )}
                    >
                      {passed ? <Check className="size-3.5" aria-hidden /> : <Icon className="size-3.5" aria-hidden />}
                    </span>
                    {w(`steps.${s}.label`)}
                  </button>
                </li>
              );
            })}
          </ol>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="h-1 w-full bg-muted md:hidden" aria-hidden>
            <div className="h-full bg-primary transition-all" style={{ width: `${((step + 1) / total) * 100}%` }} />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-7">
            <p className="text-xs font-medium uppercase tracking-wide text-primary">{w('subtitle', { n: step + 1, total })}</p>
            <DialogPrimitive.Title className="mt-1 text-xl font-semibold text-foreground sm:text-2xl">{w(`steps.${key}.title`)}</DialogPrimitive.Title>
            <DialogPrimitive.Description render={<div />} className="mt-4 flex gap-3 rounded-xl border border-primary/20 bg-primary/5 p-3.5">
              <Bot className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
              <span>
                <span className="block text-xs font-semibold uppercase tracking-wide text-primary">{w('howAgentUses')}</span>
                <span className="mt-0.5 block text-sm text-foreground/80">{w(`steps.${key}.help`)}</span>
              </span>
            </DialogPrimitive.Description>
            <div className="mt-6">{body()}</div>
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-4 sm:px-7">
            <Button variant="ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0 || busy}>
              <ArrowLeft className="size-4" aria-hidden /> {w('back')}
            </Button>
            {key === 'done' ? (
              <Button onClick={() => void close('done', '/dashboard')}>
                <Check className="size-4" aria-hidden /> {w('finish')}
              </Button>
            ) : (
              <Button onClick={() => void next()} disabled={busy}>
                {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                {busy ? w('saving') : w('next')}
                {!busy && <ArrowRight className="size-4" aria-hidden />}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  function field(id: string, label: string, input: ReactNode, optional = false) {
    return (
      <div className="space-y-1.5">
        <Label htmlFor={id}>
          {label}
          {optional && <span className="ml-1 text-xs font-normal text-muted-foreground">({w('optional')})</span>}
        </Label>
        {input}
      </div>
    );
  }

  function body(): ReactNode {
    switch (key) {
      case 'business':
        return (
          <div className="space-y-4">
            {field('wz-name', w('business.name'), <Input id="wz-name" value={biz.name} maxLength={120} placeholder={w('business.namePlaceholder')} onChange={(e) => setBiz((b) => ({ ...b, name: e.target.value }))} />)}
            <div className="space-y-1.5">
              <p className="text-sm font-medium text-foreground">{w('business.industry')}</p>
              <div role="radiogroup" aria-label={w('business.industry')} className="grid gap-2 sm:grid-cols-2">
                {PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    role="radio"
                    aria-checked={biz.industry === p.id}
                    onClick={() => {
                      if (p.id === biz.industry) return;
                      setBiz((b) => ({ ...b, industry: p.id }));
                      setModuleOverrides({});
                    }}
                    className={cn(
                      'rounded-lg border p-2.5 text-left transition-colors',
                      biz.industry === p.id ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border hover:bg-muted/50',
                    )}
                  >
                    <span className="block text-sm font-medium text-foreground">{p.name[lang]}</span>
                    <span className="block text-xs text-muted-foreground">{p.description[lang]}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <p className="text-sm font-medium text-foreground">{w('business.modules')}</p>
              <p className="text-xs text-muted-foreground">{w('business.modulesHelp')}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {MODULE_KEYS.map((k) => (
                  <label key={k} className={cn('flex cursor-pointer items-center justify-between gap-3 rounded-lg border p-2.5 transition-colors', moduleOn(k) ? 'border-primary/40 bg-primary/5' : 'border-border')}>
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-foreground">
                        {t(`business.setup.industry.module.${k}`)}
                        {preset.modules[k] && (
                          <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">{t('business.setup.industry.recommended')}</span>
                        )}
                      </span>
                      <span className="block text-xs text-muted-foreground">{t(`business.setup.industry.moduleHint.${k}`)}</span>
                    </span>
                    <Switch checked={moduleOn(k)} aria-label={t(`business.setup.industry.module.${k}`)} onCheckedChange={(v) => setModuleOverrides((m) => ({ ...m, [k]: v }))} />
                  </label>
                ))}
              </div>
            </div>
            {field('wz-detail', w('business.detail'), <Input id="wz-detail" value={biz.business_type_detail} maxLength={120} placeholder={w('business.detailPlaceholder')} onChange={(e) => setBiz((b) => ({ ...b, business_type_detail: e.target.value }))} />, true)}
            {field('wz-desc', w('business.description'), <Textarea id="wz-desc" rows={3} value={biz.description} maxLength={2000} placeholder={w('business.descriptionPlaceholder')} onChange={(e) => setBiz((b) => ({ ...b, description: e.target.value }))} />, true)}
          </div>
        );
      case 'contact': {
        const c = (k: keyof typeof contact, type = 'text', placeholder?: string) => (
          <Input id={`wz-${k}`} type={type} value={contact[k]} placeholder={placeholder} onChange={(e) => setContact((x) => ({ ...x, [k]: e.target.value }))} />
        );
        return (
          <div className="grid gap-4 sm:grid-cols-2">
            {field('wz-phone', w('contact.phone'), c('phone', 'tel'), true)}
            {field('wz-email', w('contact.email'), c('email', 'email'), true)}
            <div className="sm:col-span-2">{field('wz-address', w('contact.address'), c('address'), true)}</div>
            {field('wz-city', w('contact.city'), c('city'), true)}
            {field('wz-website', w('contact.website'), c('website', 'url', 'https://'), true)}
            <div className="sm:col-span-2">{field('wz-google_map_link', w('contact.maps'), c('google_map_link', 'url', w('contact.mapsPlaceholder')), true)}</div>
            {field('wz-timezone', w('contact.timezone'), c('timezone'))}
          </div>
        );
      }
      case 'hours':
        return (
          <div className="space-y-2">
            {hours.map((h, i) => (
              <div key={h.day_name} className="flex flex-wrap items-center gap-3 rounded-lg border border-border px-3 py-2">
                <span className="w-24 text-sm font-medium text-foreground">{w(`hours.days.${h.day_name}`)}</span>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Switch
                    checked={!h.is_closed}
                    aria-label={`${w(`hours.days.${h.day_name}`)}: ${w('hours.open')}`}
                    onCheckedChange={(v) => setHours((all) => all.map((x, j) => (j === i ? { ...x, is_closed: !v } : x)))}
                  />
                  {h.is_closed ? w('hours.closed') : w('hours.open')}
                </label>
                {!h.is_closed && (
                  <span className="ml-auto flex items-center gap-2">
                    <Input type="time" aria-label={`${w(`hours.days.${h.day_name}`)}: ${w('hours.from')}`} className="w-28" value={h.opening_time} onChange={(e) => setHours((all) => all.map((x, j) => (j === i ? { ...x, opening_time: e.target.value } : x)))} />
                    <span className="text-xs text-muted-foreground">–</span>
                    <Input type="time" aria-label={`${w(`hours.days.${h.day_name}`)}: ${w('hours.to')}`} className="w-28" value={h.closing_time} onChange={(e) => setHours((all) => all.map((x, j) => (j === i ? { ...x, closing_time: e.target.value } : x)))} />
                  </span>
                )}
              </div>
            ))}
            <Button
              variant="link"
              size="sm"
              className="px-0"
              onClick={() => setHours((all) => all.map((x) => (['Tuesday', 'Wednesday', 'Thursday', 'Friday'].includes(x.day_name) ? { ...all[0], day_name: x.day_name } : x)))}
            >
              {w('hours.copy')}
            </Button>
          </div>
        );
      case 'catalog': {
        if (!catalogKind) return <p className="rounded-lg bg-muted px-4 py-3 text-sm text-muted-foreground">{w('catalog.none')}</p>;
        const existing = counts[catalogKind];
        return (
          <div className="space-y-3">
            <p className="text-sm font-medium text-foreground">{w(`catalog.${catalogKind}`)}</p>
            {existing > 0 && <p className="text-xs text-muted-foreground">{w('catalog.existing', { n: existing })}</p>}
            {items.map((r, i) => (
              <div key={i} className="flex flex-wrap items-end gap-2">
                <div className="min-w-40 flex-1 space-y-1">
                  {i === 0 && <Label htmlFor={`wz-item-${i}`}>{w('catalog.name')}</Label>}
                  <Input id={`wz-item-${i}`} value={r.name} maxLength={200} placeholder={w(catalogKind === 'services' ? 'catalog.servicePlaceholder' : 'catalog.productPlaceholder')} aria-label={w('catalog.name')} onChange={(e) => setItems((all) => all.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                </div>
                <div className="w-28 space-y-1">
                  {i === 0 && <Label htmlFor={`wz-price-${i}`}>{w('catalog.price', { currency: ws.currency })}</Label>}
                  <Input id={`wz-price-${i}`} inputMode="decimal" value={r.price} placeholder="0.00" aria-label={w('catalog.price', { currency: ws.currency })} onChange={(e) => setItems((all) => all.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))} />
                </div>
                {catalogKind === 'services' && (
                  <div className="w-24 space-y-1">
                    {i === 0 && <Label htmlFor={`wz-dur-${i}`}>{w('catalog.duration')}</Label>}
                    <Input id={`wz-dur-${i}`} inputMode="numeric" value={r.duration} aria-label={w('catalog.duration')} onChange={(e) => setItems((all) => all.map((x, j) => (j === i ? { ...x, duration: e.target.value.replace(/\D/g, '') } : x)))} />
                  </div>
                )}
                <Button variant="ghost" size="icon" aria-label={w('catalog.remove')} disabled={items.length === 1} onClick={() => setItems((all) => all.filter((_, j) => j !== i))}>
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </div>
            ))}
            {items.length < 10 && (
              <Button variant="outline" size="sm" onClick={() => setItems((all) => [...all, emptyItem()])}>
                <Plus className="size-4" aria-hidden /> {w('catalog.add')}
              </Button>
            )}
            <p className="text-xs text-muted-foreground">{w('catalog.more', { where: w(catalogKind === 'services' ? 'catalog.whereServices' : 'catalog.whereProducts') })}</p>
          </div>
        );
      }
      case 'faqs':
        return (
          <div className="space-y-3">
            {counts.faqs > 0 && <p className="text-xs text-muted-foreground">{w('faqs.existing', { n: counts.faqs })}</p>}
            {faqs.map((r, i) => (
              <div key={i} className="space-y-2 rounded-lg border border-border p-3">
                <Input value={r.q} maxLength={300} aria-label={`${w('faqs.question')} ${i + 1}`} placeholder={w(`faqs.q${i % 3}`)} onChange={(e) => setFaqs((all) => all.map((x, j) => (j === i ? { ...x, q: e.target.value } : x)))} />
                <Textarea rows={2} value={r.a} maxLength={2000} aria-label={`${w('faqs.answer')} ${i + 1}`} placeholder={w(`faqs.a${i % 3}`)} onChange={(e) => setFaqs((all) => all.map((x, j) => (j === i ? { ...x, a: e.target.value } : x)))} />
              </div>
            ))}
            {faqs.length < 10 && (
              <Button variant="outline" size="sm" onClick={() => setFaqs((all) => [...all, { q: '', a: '' }])}>
                <Plus className="size-4" aria-hidden /> {w('faqs.add')}
              </Button>
            )}
          </div>
        );
      case 'agent':
        return (
          <div className="space-y-4">
            {agentId ? (
              <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">{w('agent.existing', { name: agent.name })}</p>
            ) : (
              agentOptions.length > 1 && (
                <div className="space-y-1.5">
                  <p className="text-sm font-medium text-foreground">{w('agent.template')}</p>
                  <div role="radiogroup" aria-label={w('agent.template')} className="grid gap-2 sm:grid-cols-2">
                    {agentOptions.map((o) => (
                      <button
                        key={o.key}
                        type="button"
                        role="radio"
                        aria-checked={template === o.key}
                        onClick={() => {
                          setTemplate(o.key);
                          setAgent((a) => ({ ...a, tone: o.tone, greeting_message: o.text[lang].greeting || a.greeting_message }));
                        }}
                        className={cn('rounded-lg border p-2.5 text-left transition-colors', template === o.key ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border hover:bg-muted/50')}
                      >
                        <span className="block text-sm font-medium text-foreground">{t(`agents.create.templates.${o.key}`)}</span>
                        <span className="block text-xs text-muted-foreground">{o.text[lang].description}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              {field('wz-agent-name', w('agent.name'), <Input id="wz-agent-name" value={agent.name} maxLength={80} placeholder={w('agent.namePlaceholder')} onChange={(e) => setAgent((a) => ({ ...a, name: e.target.value }))} />)}
              {field(
                'wz-agent-tone',
                w('agent.tone'),
                <select id="wz-agent-tone" className={selectClass} value={agent.tone} onChange={(e) => setAgent((a) => ({ ...a, tone: e.target.value }))}>
                  {AGENT_TONES.map((tone) => (
                    <option key={tone} value={tone}>
                      {t(`agents.tone.${tone}`)}
                    </option>
                  ))}
                </select>,
              )}
            </div>
            {field('wz-agent-greeting', w('agent.greeting'), <Input id="wz-agent-greeting" value={agent.greeting_message} maxLength={500} placeholder={w('agent.greetingPlaceholder')} onChange={(e) => setAgent((a) => ({ ...a, greeting_message: e.target.value }))} />, true)}
            {field('wz-agent-instructions', w('agent.instructions'), <Textarea id="wz-agent-instructions" rows={5} value={agent.instructions} maxLength={8000} placeholder={w('agent.instructionsPlaceholder')} onChange={(e) => setAgent((a) => ({ ...a, instructions: e.target.value }))} />, true)}
          </div>
        );
      case 'done': {
        const list: [boolean, string][] = [
          [!!done.business, w('done.business')],
          [!!done.contact, w('done.contact')],
          [!!done.hours, w('done.hours')],
          [catalogKind ? counts[catalogKind] > 0 : false, w('done.catalog', { n: catalogKind ? counts[catalogKind] : 0 })],
          [counts.faqs > 0, w('done.faqs', { n: counts.faqs })],
          [!!agentId, w('done.agent', { name: agent.name })],
        ];
        return (
          <div className="space-y-5">
            <div>
              <p className="mb-2 text-sm font-medium text-foreground">{w('done.saved')}</p>
              <ul className="space-y-1.5">
                {list.map(([ok, label]) => (
                  <li key={label} className="flex items-center gap-2 text-sm">
                    <span className={cn('flex size-5 items-center justify-center rounded-full', ok ? 'bg-emerald-500 text-white' : 'bg-muted text-muted-foreground')}>
                      {ok ? <Check className="size-3" aria-hidden /> : <span className="size-1.5 rounded-full bg-current" aria-hidden />}
                    </span>
                    <span className={ok ? 'text-foreground' : 'text-muted-foreground'}>{label}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void close('done', '/channels')}>{w('done.connect')}</Button>
              {agentId && (
                <Button variant="outline" onClick={() => void close('done', `/agents/${agentId}?tab=test`)}>
                  {w('done.test')}
                </Button>
              )}
            </div>
          </div>
        );
      }
    }
  }

  return (
    <DialogPrimitive.Root
      open
      disablePointerDismissal
      onOpenChange={(open) => {
        // Escape: same as "I'll set it up later".
        if (!open) void close('skipped');
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="modal-backdrop-in fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <DialogPrimitive.Popup className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 p-3 outline-none sm:p-6">
          <div className="flex h-[min(720px,calc(100dvh-5rem))] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-border bg-popover text-sm text-popover-foreground shadow-2xl">
            {shell}
          </div>
          <button
            type="button"
            onClick={() => void close('skipped')}
            className="rounded-md px-2 py-1 text-sm font-medium text-white/90 underline underline-offset-4 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
          >
            {w('later')}
          </button>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

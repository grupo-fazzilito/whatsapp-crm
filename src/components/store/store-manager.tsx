'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, ExternalLink, ImagePlus, Loader2, Trash2 } from 'lucide-react';
import { useT } from '@/i18n/client';
import { useWorkspace } from '@/hooks/use-workspace';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { uploadFile } from '@/lib/storage/client';
import type { ReadinessKey, StoreReadiness, StoreSettings } from '@/lib/store/settings';
import { LoadingBlock, Notice, PageHeader } from '@/components/business/shared';
import { CopyField } from '@/components/channels/copy-field';
import { ShippingProfiles } from './shipping-profiles';

export interface StoreState {
  settings: StoreSettings;
  readiness: StoreReadiness;
  missing: ReadinessKey[];
  missing_weight: number;
  url: string;
}

const TABS = ['general', 'shipping'] as const;
type Tab = (typeof TABS)[number];

export function StoreManager() {
  const t = useT();
  const { can } = useWorkspace();
  const readOnly = !can('admin');
  const [state, setState] = useState<StoreState | null>(null);
  const [tab, setTab] = useState<Tab>(() => {
    if (typeof window === 'undefined') return 'general';
    const q = new URLSearchParams(window.location.search).get('tab');
    return (TABS as readonly string[]).includes(q ?? '') ? (q as Tab) : 'general';
  });

  const load = useCallback(async () => {
    const res = await fetch('/api/store/settings', { cache: 'no-store' }).catch(() => null);
    if (res?.ok) setState((await res.json()) as StoreState);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load
    void load();
  }, [load]);

  const onTab = (v: unknown) => {
    const next = (TABS as readonly string[]).includes(String(v)) ? (v as Tab) : 'general';
    setTab(next);
    const url = new URL(window.location.href);
    url.searchParams.set('tab', next);
    window.history.replaceState(null, '', url);
  };

  return (
    <div className="space-y-6">
      <PageHeader title={t('store.title')} description={t('store.description')} />
      {readOnly && <Notice>{t('store.readOnly')}</Notice>}
      {!state ? (
        <LoadingBlock />
      ) : (
        <Tabs value={tab} onValueChange={onTab}>
          <TabsList>
            {TABS.map((k) => (
              <TabsTrigger key={k} value={k} className="px-3">
                {t(`store.tabs.${k}`)}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="general" className="pt-2">
            <GeneralTab state={state} readOnly={readOnly} onSaved={setState} onGoShipping={() => onTab('shipping')} />
          </TabsContent>
          <TabsContent value="shipping" className="pt-2">
            <ShippingProfiles readOnly={readOnly} missingWeight={state.missing_weight} onChanged={load} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

async function saveSettings(patch: Partial<StoreSettings>): Promise<{ ok: true; state: StoreState } | { ok: false; error: string; missing?: ReadinessKey[] }> {
  const res = await fetch('/api/store/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) }).catch(() => null);
  const body = await res?.json().catch(() => ({}));
  if (res?.ok) return { ok: true, state: body as StoreState };
  return { ok: false, error: body?.error ?? 'failed', missing: body?.missing };
}

const card = 'space-y-4 rounded-xl border border-border bg-card p-5';

function GeneralTab({ state, readOnly, onSaved, onGoShipping }: { state: StoreState; readOnly: boolean; onSaved: (s: StoreState) => void; onGoShipping: () => void }) {
  const t = useT();
  const [form, setForm] = useState(state.settings);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const s = state.settings;
  const ready = state.missing.length === 0;

  const publish = async (enabled: boolean) => {
    setPublishing(true);
    const r = await saveSettings({ enabled });
    setPublishing(false);
    if (r.ok) {
      onSaved(r.state);
      setForm((f) => ({ ...f, enabled }));
      toast.success(enabled ? t('store.publish.done') : t('store.publish.hidden'));
    } else toast.error(t('store.error'));
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const { enabled: _enabled, ...rest } = form;
    void _enabled;
    const r = await saveSettings(rest);
    setSaving(false);
    if (r.ok) {
      onSaved(r.state);
      setForm(r.state.settings);
      toast.success(t('store.saved'));
    } else toast.error(t('store.error'));
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const { url } = await uploadFile('catalog', file, { folder: 'store' });
      setForm((f) => ({ ...f, banner_url: url }));
    } catch {
      toast.error(t('store.error'));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const fixLink = (k: ReadinessKey) =>
    k === 'shipping' ? (
      <button type="button" onClick={onGoShipping} className="font-medium text-primary underline underline-offset-2">{t('store.ready.goShipping')}</button>
    ) : k === 'products' ? (
      <Link href="/catalog" className="font-medium text-primary underline underline-offset-2">{t('store.ready.goCatalog')}</Link>
    ) : (
      <Link href="/business/setup?tab=orders" className="font-medium text-primary underline underline-offset-2">{t('store.ready.goSetup')}</Link>
    );

  return (
    <div className="space-y-5">
      <section className={card} aria-labelledby="store-publish">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <h2 id="store-publish" className="flex items-center gap-2 text-base font-semibold">
              {s.enabled ? <CheckCircle2 className="size-5 text-emerald-500" aria-hidden /> : <AlertTriangle className="size-5 text-amber-500" aria-hidden />}
              {s.enabled ? t('store.publish.on') : t('store.publish.off')}
            </h2>
            {!s.enabled && <p className="text-sm text-muted-foreground">{t('store.publish.hint')}</p>}
          </div>
          <div className="flex items-center gap-2">
            {publishing && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />}
            <Label htmlFor="store-enabled" className="text-sm">{t('store.publish.title')}</Label>
            <Switch id="store-enabled" checked={s.enabled} disabled={readOnly || publishing || (!s.enabled && !ready)} onCheckedChange={(v) => void publish(!!v)} />
          </div>
        </div>

        {!ready && (
          <div role="note" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <p className="font-medium text-amber-900 dark:text-amber-200">{t('store.ready.title')}</p>
            <ul className="mt-2 space-y-1.5">
              {state.missing.map((k) => (
                <li key={k} className="flex flex-wrap items-center gap-x-2 text-amber-900 dark:text-amber-100">
                  <span>• {t(`store.ready.${k}`)}</span>
                  {fixLink(k)}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <CopyField label={t('store.link')} value={state.url} />
          <Button variant="outline" render={<a href={state.url} target="_blank" rel="noopener noreferrer" />}>
            <ExternalLink className="size-4" aria-hidden /> {s.enabled ? t('store.open') : t('store.preview')}
          </Button>
        </div>
      </section>

      <form onSubmit={save} className="space-y-5">
        <section className={card} aria-labelledby="store-look">
          <h2 id="store-look" className="text-base font-semibold">{t('store.look.title')}</h2>
          <div className="grid gap-1.5">
            <Label htmlFor="store-tagline">{t('store.look.tagline')}</Label>
            <Input id="store-tagline" maxLength={160} disabled={readOnly} value={form.tagline ?? ''} placeholder={t('store.look.taglinePlaceholder')} onChange={(e) => setForm({ ...form, tagline: e.target.value })} />
          </div>
          <div className="grid gap-1.5">
            <span className="text-sm font-medium">{t('store.look.banner')}</span>
            {form.banner_url ? (
              // eslint-disable-next-line @next/next/no-img-element -- uploaded banner preview
              <img src={form.banner_url} alt="" className="aspect-[4/1] w-full rounded-lg border border-border object-cover" />
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" id="store-banner" disabled={readOnly || uploading} onChange={(e) => void upload(e.target.files?.[0])} />
              <Button type="button" variant="outline" size="sm" disabled={readOnly || uploading} onClick={() => fileRef.current?.click()}>
                {uploading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ImagePlus className="size-4" aria-hidden />}
                {t('store.look.upload')}
              </Button>
              {form.banner_url && (
                <Button type="button" variant="ghost" size="sm" disabled={readOnly} onClick={() => setForm({ ...form, banner_url: null })}>
                  <Trash2 className="size-4" aria-hidden /> {t('store.look.remove')}
                </Button>
              )}
              <span className="text-xs text-muted-foreground">{t('store.look.bannerHint')}</span>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="store-accent">{t('store.look.accent')}</Label>
              <div className="flex items-center gap-2">
                <input id="store-accent" type="color" disabled={readOnly} value={form.accent} onChange={(e) => setForm({ ...form, accent: e.target.value })} className="h-9 w-12 cursor-pointer rounded-md border border-input bg-transparent p-1" />
                <code className="text-xs text-muted-foreground">{form.accent}</code>
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="store-wa">{t('store.look.whatsapp')}</Label>
              <Input id="store-wa" inputMode="tel" maxLength={20} disabled={readOnly} value={form.whatsapp ?? ''} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} aria-describedby="store-wa-hint" />
              <p id="store-wa-hint" className="text-xs text-muted-foreground">{t('store.look.whatsappHint')}</p>
            </div>
          </div>
        </section>

        <section className={card} aria-labelledby="store-pickup">
          <h2 id="store-pickup" className="text-base font-semibold">{t('store.pickup.title')}</h2>
          <div className="flex items-center gap-3">
            <Switch id="store-pickup-on" checked={form.pickup_enabled} disabled={readOnly} onCheckedChange={(v) => setForm({ ...form, pickup_enabled: !!v })} />
            <Label htmlFor="store-pickup-on">{t('store.pickup.enable')}</Label>
          </div>
          {form.pickup_enabled && (
            <div className="grid gap-1.5">
              <Label htmlFor="store-pickup-address">{t('store.pickup.address')}</Label>
              <Input id="store-pickup-address" maxLength={240} disabled={readOnly} value={form.pickup_address ?? ''} placeholder={t('store.pickup.addressPlaceholder')} onChange={(e) => setForm({ ...form, pickup_address: e.target.value })} />
            </div>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="store-note">{t('store.checkoutNote')}</Label>
            <Textarea id="store-note" rows={2} maxLength={400} disabled={readOnly} value={form.checkout_note ?? ''} placeholder={t('store.checkoutNotePlaceholder')} onChange={(e) => setForm({ ...form, checkout_note: e.target.value })} />
          </div>
        </section>

        {!readOnly && (
          <Button type="submit" disabled={saving}>
            {saving && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {t('store.save')}
          </Button>
        )}
      </form>
    </div>
  );
}

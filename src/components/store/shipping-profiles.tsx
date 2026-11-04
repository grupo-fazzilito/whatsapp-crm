'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Loader2, Pencil, Plus, Scale, Trash2, Truck, X } from 'lucide-react';
import { useT } from '@/i18n/client';
import { useWorkspace } from '@/hooks/use-workspace';
import { formatMoney, moneyLocale } from '@/lib/workspace/countries';
import type { ShippingProfile, ShippingType } from '@/lib/store/shipping';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';

interface Props {
  readOnly: boolean;
  missingWeight: number;
  /** Profiles changed: the store's readiness may have too. */
  onChanged: () => void;
}

export function ShippingProfiles({ readOnly, missingWeight, onChanged }: Props) {
  const t = useT();
  const { workspace } = useWorkspace();
  const money = (n: number) => formatMoney(n, workspace?.currency ?? 'PEN', moneyLocale({ locale: workspace?.locale, country: workspace?.country }));
  const [profiles, setProfiles] = useState<ShippingProfile[] | null>(null);
  const [editing, setEditing] = useState<ShippingProfile | 'new' | null>(null);
  const [deleting, setDeleting] = useState<ShippingProfile | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/store/shipping-profiles', { cache: 'no-store' }).catch(() => null);
    if (res?.ok) setProfiles(((await res.json()) as { profiles: ShippingProfile[] }).profiles);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load
    void load();
  }, [load]);

  const remove = async () => {
    if (!deleting) return;
    const res = await fetch(`/api/store/shipping-profiles/${deleting.id}`, { method: 'DELETE' }).catch(() => null);
    const body = await res?.json().catch(() => ({}));
    if (res?.ok) {
      toast.success(t('store.shipping.deleted'));
      await load();
      onChanged();
    } else toast.error(t(`store.shipping.errors.${body?.error ?? 'name'}`));
    setDeleting(null);
  };

  const summary = (p: ShippingProfile) => {
    const base =
      p.type === 'free'
        ? t('store.shipping.summary.free')
        : p.type === 'flat'
          ? t('store.shipping.summary.flat', { price: money(p.flat_price ?? 0) })
          : t('store.shipping.summary.weight', { n: p.rates.length });
    return [base, p.free_over !== null && p.type !== 'free' ? t('store.shipping.freeOver', { amount: money(p.free_over) }) : null, p.eta].filter(Boolean).join(' · ');
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">{t('store.shipping.title')}</h2>
          <p className="text-sm text-muted-foreground">{t('store.shipping.description')}</p>
        </div>
        {!readOnly && (
          <Button onClick={() => setEditing('new')}>
            <Plus className="size-4" aria-hidden /> {t('store.shipping.add')}
          </Button>
        )}
      </div>

      {missingWeight > 0 && profiles?.some((p) => p.type === 'weight' && p.is_active) && (
        <p role="note" className="flex flex-wrap items-center gap-x-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-100">
          <Scale className="size-4" aria-hidden /> {t('store.shipping.missingWeight', { n: missingWeight })}
          <Link href="/catalog" className="font-medium underline underline-offset-2">{t('store.shipping.fixWeights')}</Link>
        </p>
      )}

      {!profiles ? (
        <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />
      ) : profiles.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">{t('store.shipping.empty')}</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {profiles.map((p) => (
            <li key={p.id} className="flex items-start gap-3 rounded-xl border border-border bg-card p-4">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                {p.type === 'weight' ? <Scale className="size-4" aria-hidden /> : <Truck className="size-4" aria-hidden />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-sm font-semibold">
                  <span className="truncate">{p.name}</span>
                  {!p.is_active && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{t('store.shipping.inactive')}</span>}
                </p>
                <p className="text-xs text-muted-foreground">{t(`store.shipping.type.${p.type}`)}</p>
                <p className="mt-1 text-sm">{summary(p)}</p>
                {p.type === 'weight' && (
                  <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                    {p.rates.map((r, i) => (
                      <li key={i}>
                        {(i === 0 ? '0' : String(p.rates[i - 1].up_to_kg))} – {r.up_to_kg === null ? t('store.shipping.andAbove') : `${r.up_to_kg} kg`}: {money(r.price)}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {!readOnly && (
                <div className="flex shrink-0 gap-1">
                  <Button variant="ghost" size="icon-sm" aria-label={`${t('store.shipping.edit')}: ${p.name}`} onClick={() => setEditing(p)}>
                    <Pencil className="size-4" aria-hidden />
                  </Button>
                  <Button variant="ghost" size="icon-sm" aria-label={`${t('store.shipping.delete')}: ${p.name}`} onClick={() => setDeleting(p)}>
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <ShippingEditor
          profile={editing === 'new' ? null : editing}
          currency={workspace?.currency ?? 'PEN'}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
            onChanged();
          }}
        />
      )}
      <ConfirmationDialog
        isOpen={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t('store.shipping.delete')}
        description={t('store.shipping.deleteConfirm', { name: deleting?.name ?? '' })}
        confirmText={t('store.shipping.delete')}
        cancelText={t('store.shipping.cancel')}
        variant="destructive"
        onConfirm={remove}
      />
    </div>
  );
}

interface RateRow {
  up_to_kg: string;
  price: string;
}

function ShippingEditor({ profile, currency, onClose, onSaved }: { profile: ShippingProfile | null; currency: string; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const [name, setName] = useState(profile?.name ?? '');
  const [type, setType] = useState<ShippingType>(profile?.type ?? 'flat');
  const [flat, setFlat] = useState(profile?.flat_price != null ? String(profile.flat_price) : '');
  const [rates, setRates] = useState<RateRow[]>(
    profile?.rates.length
      ? profile.rates.map((r) => ({ up_to_kg: r.up_to_kg === null ? '' : String(r.up_to_kg), price: String(r.price) }))
      : [
          { up_to_kg: '1', price: '' },
          { up_to_kg: '5', price: '' },
          { up_to_kg: '', price: '' },
        ],
  );
  const [freeOver, setFreeOver] = useState(profile?.free_over != null ? String(profile.free_over) : '');
  const [eta, setEta] = useState(profile?.eta ?? '');
  const [active, setActive] = useState(profile?.is_active ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const body = {
      name,
      type,
      flat_price: type === 'flat' ? flat : null,
      rates: type === 'weight' ? rates.map((r) => ({ up_to_kg: r.up_to_kg.trim() === '' ? null : r.up_to_kg, price: r.price })) : [],
      free_over: type === 'free' ? null : freeOver,
      eta,
      is_active: active,
      sort_order: profile?.sort_order ?? 0,
    };
    const res = await fetch(profile ? `/api/store/shipping-profiles/${profile.id}` : '/api/store/shipping-profiles', {
      method: profile ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => null);
    const data = await res?.json().catch(() => ({}));
    setSaving(false);
    if (res?.ok) {
      toast.success(t('store.shipping.saved'));
      onSaved();
    } else setError(t(`store.shipping.errors.${data?.error ?? 'name'}`));
  };

  const types: ShippingType[] = ['free', 'flat', 'weight'];
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{profile ? profile.name : t('store.shipping.add')}</DialogTitle>
            <DialogDescription>{t(`store.shipping.typeHint.${type}`)}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-1.5">
            <Label htmlFor="sp-name">{t('store.shipping.name')}</Label>
            <Input id="sp-name" required maxLength={80} value={name} placeholder={t('store.shipping.namePlaceholder')} onChange={(e) => setName(e.target.value)} />
          </div>

          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">{t('store.shipping.typeLegend')}</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {types.map((k) => (
                <label key={k} className={`flex cursor-pointer items-center gap-2 rounded-lg border p-3 text-sm ${type === k ? 'border-primary bg-primary/5' : 'border-border hover:bg-accent'}`}>
                  <input type="radio" name="sp-type" value={k} checked={type === k} onChange={() => setType(k)} className="accent-[var(--primary)]" />
                  {t(`store.shipping.type.${k}`)}
                </label>
              ))}
            </div>
          </fieldset>

          {type === 'flat' && (
            <div className="grid gap-1.5 sm:w-1/2">
              <Label htmlFor="sp-flat">{t('store.shipping.price')} ({currency})</Label>
              <Input id="sp-flat" required inputMode="decimal" value={flat} onChange={(e) => setFlat(e.target.value.replace(',', '.'))} />
            </div>
          )}

          {type === 'weight' && (
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">{t('store.shipping.rates')}</legend>
              <div className="grid grid-cols-[1fr_1fr_auto] gap-2 text-xs font-medium text-muted-foreground" aria-hidden>
                <span>{t('store.shipping.upTo')}</span>
                <span>{t('store.shipping.ratePrice')} ({currency})</span>
                <span className="w-8" />
              </div>
              {rates.map((r, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
                  <Input
                    aria-label={`${t('store.shipping.upTo')} ${i + 1}`}
                    inputMode="decimal"
                    value={r.up_to_kg}
                    placeholder={i === rates.length - 1 ? t('store.shipping.andAbove') : ''}
                    onChange={(e) => setRates(rates.map((x, k) => (k === i ? { ...x, up_to_kg: e.target.value.replace(',', '.') } : x)))}
                  />
                  <Input
                    aria-label={`${t('store.shipping.ratePrice')} ${i + 1}`}
                    required
                    inputMode="decimal"
                    value={r.price}
                    onChange={(e) => setRates(rates.map((x, k) => (k === i ? { ...x, price: e.target.value.replace(',', '.') } : x)))}
                  />
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={`${t('store.shipping.removeRate')} ${i + 1}`} disabled={rates.length <= 1} onClick={() => setRates(rates.filter((_, k) => k !== i))}>
                    <X className="size-4" aria-hidden />
                  </Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" className="justify-self-start" disabled={rates.length >= 20} onClick={() => setRates([...rates, { up_to_kg: '', price: '' }])}>
                <Plus className="size-4" aria-hidden /> {t('store.shipping.addRate')}
              </Button>
              <p className="text-xs text-muted-foreground">{t('store.shipping.ratesHint')}</p>
            </fieldset>
          )}

          {type !== 'free' && (
            <div className="grid gap-1.5 sm:w-1/2">
              <Label htmlFor="sp-free">{t('store.shipping.freeOverLabel')} ({currency})</Label>
              <Input id="sp-free" inputMode="decimal" value={freeOver} onChange={(e) => setFreeOver(e.target.value.replace(',', '.'))} aria-describedby="sp-free-hint" />
              <p id="sp-free-hint" className="text-xs text-muted-foreground">{t('store.shipping.freeOverHint')}</p>
            </div>
          )}

          <div className="grid gap-1.5">
            <Label htmlFor="sp-eta">{t('store.shipping.eta')}</Label>
            <Input id="sp-eta" maxLength={80} value={eta} placeholder={t('store.shipping.etaPlaceholder')} onChange={(e) => setEta(e.target.value)} />
          </div>

          <div className="flex items-center gap-3">
            <Switch id="sp-active" checked={active} onCheckedChange={(v) => setActive(!!v)} />
            <Label htmlFor="sp-active">{t('store.shipping.active')}</Label>
          </div>

          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>{t('store.shipping.cancel')}</Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {t('store.shipping.saveProfile')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

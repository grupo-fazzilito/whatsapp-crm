'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Minus, Plus, Search, Trash2, X } from 'lucide-react';
import { useI18n } from '@/i18n/client';
import { useWorkspace } from '@/hooks/use-workspace';
import { createClient } from '@/lib/supabase/client';
import { getPreset } from '@/lib/industries';
import { formatMoney, moneyLocale } from '@/lib/workspace/countries';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { selectClass } from '@/components/business/shared';
import { cn } from '@/lib/utils';
import { FULFILLMENTS, type Fulfillment } from './types';

interface ContactHit {
  id: string;
  name: string | null;
  phone: string | null;
}
interface VariantHit {
  id: string;
  name: string;
  price: number | null;
  is_active: boolean;
}
interface ProductHit {
  id: string;
  name: string;
  price: number | null;
  product_variants: VariantHit[];
}
interface Line {
  key: string;
  product: ProductHit;
  variantId: string | null;
  quantity: number;
}

const clean = (s: string) => s.replace(/[,()*%\\]/g, ' ').trim();

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (orderId: string) => void;
}

export function NewOrderDialog({ open, onOpenChange, onCreated }: Props) {
  const { t, locale } = useI18n();
  const { workspace } = useWorkspace();

  const allowed: Fulfillment[] = useMemo(() => {
    const raw = (workspace?.settings?.orders as { fulfillment?: Fulfillment[] } | undefined)?.fulfillment;
    const list = (Array.isArray(raw) ? raw : (getPreset(workspace?.industry).fulfillment as Fulfillment[])).filter((f) => FULFILLMENTS.includes(f));
    return list.length ? list : ['pickup'];
  }, [workspace]);
  const deliveryFee = Math.max(0, Number((workspace?.settings?.orders as { delivery_fee?: number } | undefined)?.delivery_fee ?? 0) || 0);

  const [contact, setContact] = useState<ContactHit | null>(null);
  const [contactQ, setContactQ] = useState('');
  const [contacts, setContacts] = useState<ContactHit[]>([]);
  const [productQ, setProductQ] = useState('');
  const [products, setProducts] = useState<ProductHit[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [fulfillment, setFulfillment] = useState<Fulfillment>(allowed[0]);
  const [address, setAddress] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const money = (n: number) => formatMoney(n, workspace?.currency ?? 'USD', moneyLocale({ locale, country: workspace?.country }));

  useEffect(() => {
    if (contact) return;
    const s = clean(contactQ);
    let cancelled = false;
    const id = setTimeout(async () => {
      let q = createClient().from('contacts').select('id, name, phone');
      if (s) q = q.or(`name.ilike.%${s}%,phone.ilike.%${s}%`);
      const { data } = await q.order('updated_at', { ascending: false }).limit(8);
      if (!cancelled) setContacts((data ?? []) as ContactHit[]);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [contactQ, contact]);

  useEffect(() => {
    const s = clean(productQ);
    let cancelled = false;
    const id = setTimeout(async () => {
      let q = createClient().from('products').select('id, name, price, product_variants(id, name, price, is_active)').eq('is_active', true);
      if (s) q = q.ilike('name', `%${s}%`);
      const { data } = await q.order('name').limit(8);
      if (!cancelled) setProducts((data ?? []) as ProductHit[]);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [productQ]);

  const activeVariants = (p: ProductHit) => (p.product_variants ?? []).filter((v) => v.is_active);
  const priceOf = (l: Line) => {
    const v = l.variantId ? l.product.product_variants.find((x) => x.id === l.variantId) : null;
    return v?.price ?? l.product.price;
  };

  const addProduct = (p: ProductHit) => {
    const variants = activeVariants(p);
    const variantId = variants[0]?.id ?? null;
    setLines((prev) => {
      const existing = prev.find((l) => l.product.id === p.id && l.variantId === variantId);
      if (existing) return prev.map((l) => (l === existing ? { ...l, quantity: Math.min(999, l.quantity + 1) } : l));
      return [...prev, { key: crypto.randomUUID(), product: p, variantId, quantity: 1 }];
    });
  };

  const update = (key: string, patch: Partial<Line>) => setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const subtotal = lines.reduce((a, l) => a + (Number(priceOf(l)) || 0) * l.quantity, 0);
  const fee = fulfillment === 'delivery' ? deliveryFee : 0;
  const missingPrice = lines.some((l) => priceOf(l) === null);
  const canSave = !!contact && lines.length > 0 && !missingPrice && (fulfillment !== 'delivery' || !!address.trim()) && !saving;

  const submit = async () => {
    if (!canSave || !contact) return;
    setSaving(true);
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contact_id: contact.id,
          items: lines.map((l) => ({ product_id: l.product.id, variant_id: l.variantId, quantity: l.quantity })),
          fulfillment,
          address: fulfillment === 'delivery' ? address : undefined,
          address_reference: reference || undefined,
          notes: notes || undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { order?: { id: string; number: number }; error?: string; detail?: string };
      if (!res.ok || !data.order) {
        toast.error(t(`orders.new.errors.${data.error ?? 'generic'}`, { name: data.error === 'unavailable' ? (data.detail ? `: ${data.detail}` : '') : data.detail ?? '' }));
        return;
      }
      toast.success(t('orders.new.created', { number: data.order.number }));
      onCreated(data.order.id);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('orders.new.title')}</DialogTitle>
          <DialogDescription>{t('orders.new.description')}</DialogDescription>
        </DialogHeader>

        {/* Customer */}
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium">{t('orders.new.customer')}</legend>
          {contact ? (
            <div className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
              <span>
                <span className="font-medium">{contact.name || contact.phone}</span>
                {contact.name && contact.phone && <span className="text-muted-foreground"> · {contact.phone}</span>}
              </span>
              <Button variant="ghost" size="icon-sm" aria-label={t('orders.new.changeCustomer')} onClick={() => setContact(null)}>
                <X className="size-4" />
              </Button>
            </div>
          ) : (
            <>
              <div className="relative">
                <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={contactQ} onChange={(e) => setContactQ(e.target.value)} placeholder={t('orders.new.searchCustomer')} aria-label={t('orders.new.searchCustomer')} className="pl-8" />
              </div>
              <ul className="grid max-h-40 gap-1 overflow-y-auto">
                {contacts.map((c) => (
                  <li key={c.id}>
                    <button type="button" onClick={() => setContact(c)} className="w-full rounded-md px-3 py-1.5 text-left text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      {c.name || c.phone} {c.name && c.phone && <span className="text-muted-foreground">· {c.phone}</span>}
                    </button>
                  </li>
                ))}
                {contacts.length === 0 && <li className="px-3 py-1.5 text-sm text-muted-foreground">{t('orders.new.noCustomers')}</li>}
              </ul>
            </>
          )}
        </fieldset>

        {/* Products */}
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium">{t('orders.new.products')}</legend>
          <div className="relative">
            <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={productQ} onChange={(e) => setProductQ(e.target.value)} placeholder={t('orders.new.searchProduct')} aria-label={t('orders.new.searchProduct')} className="pl-8" />
          </div>
          <ul className="flex flex-wrap gap-1.5">
            {products.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => addProduct(p)}
                  className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Plus className="size-3" />
                  {p.name}
                  {p.price !== null && <span className="text-muted-foreground">· {money(Number(p.price))}</span>}
                </button>
              </li>
            ))}
          </ul>
          {lines.length > 0 && (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {lines.map((l) => {
                const variants = activeVariants(l.product);
                const price = priceOf(l);
                return (
                  <li key={l.key} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                    <span className="min-w-0 flex-1 truncate font-medium">{l.product.name}</span>
                    {variants.length > 0 && (
                      <select
                        aria-label={t('orders.new.variant')}
                        className={cn(selectClass, 'w-36')}
                        value={l.variantId ?? ''}
                        onChange={(e) => update(l.key, { variantId: e.target.value || null })}
                      >
                        {variants.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.name}
                          </option>
                        ))}
                      </select>
                    )}
                    <span className="inline-flex items-center gap-1">
                      <Button variant="outline" size="icon-sm" aria-label={t('orders.new.less')} disabled={l.quantity <= 1} onClick={() => update(l.key, { quantity: l.quantity - 1 })}>
                        <Minus className="size-3.5" />
                      </Button>
                      <Input
                        type="number"
                        min={1}
                        max={999}
                        value={l.quantity}
                        aria-label={t('orders.new.quantity')}
                        onChange={(e) => update(l.key, { quantity: Math.min(999, Math.max(1, Number(e.target.value) || 1)) })}
                        className="h-7 w-14 text-center"
                      />
                      <Button variant="outline" size="icon-sm" aria-label={t('orders.new.more')} onClick={() => update(l.key, { quantity: Math.min(999, l.quantity + 1) })}>
                        <Plus className="size-3.5" />
                      </Button>
                    </span>
                    <span className="w-24 text-right tabular-nums">{price === null ? t('orders.new.noPrice') : money(Number(price) * l.quantity)}</span>
                    <Button variant="ghost" size="icon-sm" aria-label={t('orders.new.remove')} onClick={() => setLines((prev) => prev.filter((x) => x.key !== l.key))}>
                      <Trash2 className="size-4" />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </fieldset>

        {/* Fulfillment */}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-sm font-medium">
            {t('orders.detail.fulfillment')}
            <select className={selectClass} value={fulfillment} onChange={(e) => setFulfillment(e.target.value as Fulfillment)}>
              {allowed.map((f) => (
                <option key={f} value={f}>
                  {t(`orders.fulfillment.${f}`)}
                </option>
              ))}
            </select>
          </label>
          {fulfillment === 'delivery' && (
            <label className="grid gap-1 text-sm font-medium">
              {t('orders.new.address')}
              <Input value={address} onChange={(e) => setAddress(e.target.value)} maxLength={300} required />
            </label>
          )}
          {fulfillment === 'delivery' && (
            <label className="grid gap-1 text-sm font-medium sm:col-span-2">
              {t('orders.detail.reference')}
              <Input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={300} />
            </label>
          )}
          <label className="grid gap-1 text-sm font-medium sm:col-span-2">
            {t('orders.detail.notes')}
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} />
          </label>
        </div>

        <dl className="grid gap-1 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">{t('orders.detail.subtotal')}</dt>
            <dd className="tabular-nums">{money(subtotal)}</dd>
          </div>
          {fee > 0 && (
            <div className="flex justify-between">
              <dt className="text-muted-foreground">{t('orders.detail.deliveryFee')}</dt>
              <dd className="tabular-nums">{money(fee)}</dd>
            </div>
          )}
          <div className="flex justify-between font-semibold">
            <dt>{t('orders.detail.total')}</dt>
            <dd className="tabular-nums">{money(subtotal + fee)}</dd>
          </div>
        </dl>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('orders.actions.back')}
          </Button>
          <Button onClick={submit} disabled={!canSave}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            {t('orders.new.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

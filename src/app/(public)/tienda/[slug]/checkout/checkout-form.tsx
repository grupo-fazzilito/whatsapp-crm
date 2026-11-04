'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2, Lock, MapPin, Store, Truck } from 'lucide-react';
import type { StorePaymentMethod } from '@/lib/store/server';
import type { ShippingType } from '@/lib/store/shipping';
import { fill } from '@/lib/store/texts';
import { LineImage, useStore } from '../cart';

interface ShippingOption {
  id: string;
  name: string;
  type: ShippingType;
  eta: string | null;
  free_over: number | null;
}

interface Props {
  preview: boolean;
  dialCode: string;
  pickup: { address: string } | null;
  note: string | null;
  shipping: ShippingOption[];
  payments: StorePaymentMethod[];
}

interface Quote {
  subtotal: number;
  weight_kg: number;
  shipping: { id: string; fee: number | null }[];
}

type QuoteError = { error: string; name?: string; available?: number };

const field = 'h-11 w-full rounded-xl border border-slate-300 bg-white px-3.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-500 focus:outline-none aria-[invalid=true]:border-red-500';
const label = 'mb-1.5 block text-sm font-medium text-slate-800';
const card = 'space-y-4 rounded-2xl bg-white p-5 ring-1 ring-slate-200';

export function CheckoutForm({ preview, dialCode, pickup, note, shipping, payments }: Props) {
  const { lines, ready, t, money, config, clear } = useStore();
  const router = useRouter();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState<QuoteError | null>(null);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [doc, setDoc] = useState('');
  const [fulfillment, setFulfillment] = useState<'delivery' | 'pickup'>(shipping.length ? 'delivery' : 'pickup');
  const [profileId, setProfileId] = useState<string>(shipping[0]?.id ?? '');
  const [address, setAddress] = useState({ department: '', province: '', district: '', line: '', reference: '' });
  const [paymentId, setPaymentId] = useState(payments[0]?.id ?? '');
  const [notes, setNotes] = useState('');
  const [website, setWebsite] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<{ code: string; name?: string; available?: number } | null>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);

  const items = useMemo(() => lines.map((l) => ({ product_id: l.product_id, variant_id: l.variant_id, quantity: l.quantity })), [lines]);

  // The server's prices and shipping fees for this cart.
  useEffect(() => {
    if (!ready || !items.length) return;
    let cancelled = false;
    fetch(`/api/public/store/${encodeURIComponent(config.slug)}/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    })
      .then(async (r) => ({ ok: r.ok, body: await r.json().catch(() => ({})) }))
      .then(({ ok, body }) => {
        if (cancelled) return;
        if (ok) {
          setQuote(body as Quote);
          setQuoteError(null);
        } else setQuoteError(body as QuoteError);
      })
      .catch(() => !cancelled && setQuoteError({ error: 'failed' }));
    return () => {
      cancelled = true;
    };
  }, [items, ready, config.slug]);

  const fee = fulfillment === 'pickup' ? 0 : (quote?.shipping.find((s) => s.id === profileId)?.fee ?? null);
  const subtotal = quote?.subtotal ?? 0;
  const total = fee === null ? null : Math.round((subtotal + fee) * 100) / 100;

  const errorText = (e: { code: string; name?: string; available?: number }) => {
    const tpl = (t.errors as Record<string, string>)[e.code] ?? t.errors.failed;
    return fill(tpl, { name: e.name ?? '', available: e.available ?? 0 });
  };

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (preview || sending) return;
    setSending(true);
    setError(null);
    const res = await fetch(`/api/public/store/${encodeURIComponent(config.slug)}/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items,
        customer: { name, phone, email, document: doc },
        fulfillment,
        shipping_profile_id: fulfillment === 'delivery' ? profileId : null,
        address: fulfillment === 'delivery' ? address : null,
        payment_method_id: paymentId,
        notes,
        website,
      }),
    }).catch(() => null);
    const body = (await res?.json().catch(() => ({}))) as { url?: string; error?: string; name?: string; available?: number };
    if (res?.status === 201 && body.url) {
      clear();
      router.push(body.url);
      return;
    }
    setSending(false);
    setError({ code: res?.status === 429 ? 'rate' : (body.error ?? 'failed'), name: body.name, available: body.available });
    requestAnimationFrame(() => errorRef.current?.focus());
  };

  if (!ready) return <Loader2 className="mx-auto mt-16 size-6 animate-spin text-slate-400" aria-label="…" />;

  if (!lines.length) {
    return (
      <div className="mx-auto mt-10 max-w-md rounded-2xl bg-white p-8 text-center ring-1 ring-slate-200">
        <p className="text-slate-600">{t.emptyCart}</p>
        <Link href={`/tienda/${encodeURIComponent(config.slug)}`} className="mt-4 inline-block text-sm font-semibold underline underline-offset-4" style={{ color: config.accent }}>
          {t.keepShopping}
        </Link>
      </div>
    );
  }

  const invalid = (code: string) => error?.code === code || undefined;

  return (
    <form onSubmit={submit} noValidate className="grid gap-6 lg:grid-cols-[1fr_380px] lg:items-start">
      <div className="space-y-5">
        <h1 className="text-2xl font-bold">{t.checkout}</h1>
        {preview && <p role="status" className="rounded-xl bg-amber-100 px-4 py-3 text-sm text-amber-900">{t.previewNoOrders}</p>}

        <section className={card} aria-labelledby="co-contact">
          <h2 id="co-contact" className="text-base font-semibold">{t.contact}</h2>
          <div>
            <label htmlFor="co-name" className={label}>{t.name}</label>
            <input id="co-name" className={field} required autoComplete="name" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} aria-invalid={invalid('name')} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="co-phone" className={label}>{t.phone}</label>
              <div className="flex">
                <span className="inline-flex items-center rounded-l-xl border border-r-0 border-slate-300 bg-slate-50 px-3 text-sm text-slate-600">+{dialCode.replace(/\D/g, "")}</span>
                <input id="co-phone" className={`${field} rounded-l-none`} required type="tel" inputMode="tel" autoComplete="tel-national" maxLength={20} value={phone} onChange={(e) => setPhone(e.target.value)} aria-invalid={invalid('phone')} aria-describedby="co-phone-hint" />
              </div>
              <p id="co-phone-hint" className="mt-1 text-xs text-slate-500">{t.phoneHint}</p>
            </div>
            <div>
              <label htmlFor="co-email" className={label}>{t.email}</label>
              <input id="co-email" className={field} type="email" autoComplete="email" maxLength={160} value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={invalid('email')} aria-describedby="co-email-hint" />
              <p id="co-email-hint" className="mt-1 text-xs text-slate-500">{t.emailHint}</p>
            </div>
          </div>
          <div className="sm:w-1/2 sm:pr-2">
            <label htmlFor="co-doc" className={label}>{t.document}</label>
            <input id="co-doc" className={field} inputMode="numeric" maxLength={20} value={doc} onChange={(e) => setDoc(e.target.value)} aria-invalid={invalid('document')} />
          </div>
          {/* Honeypot for bots: hidden from people and assistive tech. */}
          <input type="text" name="website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} className="hidden" aria-hidden />
        </section>

        <section className={card} aria-labelledby="co-delivery">
          <h2 id="co-delivery" className="text-base font-semibold">{t.delivery}</h2>
          <div className="grid gap-2" role="radiogroup" aria-labelledby="co-delivery">
            {shipping.map((s) => {
              const q = quote?.shipping.find((x) => x.id === s.id);
              const tooHeavy = q && q.fee === null;
              const active = fulfillment === 'delivery' && profileId === s.id;
              return (
                <Option
                  key={s.id}
                  name="co-ship"
                  checked={active}
                  disabled={!!tooHeavy}
                  onChange={() => {
                    setFulfillment('delivery');
                    setProfileId(s.id);
                  }}
                  icon={<Truck className="size-5" aria-hidden />}
                  title={s.name}
                  detail={[s.eta, s.free_over !== null && s.type !== 'free' ? fill(t.freeOver, { amount: money(s.free_over) }) : null].filter(Boolean).join(' · ')}
                  right={tooHeavy ? t.tooHeavy : q ? (q.fee === 0 ? t.free : money(q.fee!)) : '…'}
                />
              );
            })}
            {pickup && (
              <Option
                name="co-ship"
                checked={fulfillment === 'pickup'}
                onChange={() => setFulfillment('pickup')}
                icon={<Store className="size-5" aria-hidden />}
                title={t.pickup}
                detail={fill(t.pickupAt, { address: pickup.address })}
                right={t.free}
              />
            )}
          </div>

          {fulfillment === 'delivery' && (
            <fieldset className="space-y-4 border-t border-slate-100 pt-4">
              <legend className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
                <MapPin className="size-4" aria-hidden /> {t.address}
              </legend>
              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <label htmlFor="co-dep" className={label}>{t.department}</label>
                  <input id="co-dep" className={field} required autoComplete="address-level1" maxLength={80} value={address.department} onChange={(e) => setAddress({ ...address, department: e.target.value })} aria-invalid={invalid('address')} />
                </div>
                <div>
                  <label htmlFor="co-prov" className={label}>{t.province}</label>
                  <input id="co-prov" className={field} autoComplete="address-level2" maxLength={80} value={address.province} onChange={(e) => setAddress({ ...address, province: e.target.value })} />
                </div>
                <div>
                  <label htmlFor="co-dist" className={label}>{t.district}</label>
                  <input id="co-dist" className={field} required autoComplete="address-level3" maxLength={80} value={address.district} onChange={(e) => setAddress({ ...address, district: e.target.value })} aria-invalid={invalid('address')} />
                </div>
              </div>
              <div>
                <label htmlFor="co-line" className={label}>{t.line}</label>
                <input id="co-line" className={field} required autoComplete="street-address" maxLength={200} value={address.line} onChange={(e) => setAddress({ ...address, line: e.target.value })} aria-invalid={invalid('address')} />
              </div>
              <div>
                <label htmlFor="co-ref" className={label}>{t.reference}</label>
                <input id="co-ref" className={field} maxLength={200} value={address.reference} onChange={(e) => setAddress({ ...address, reference: e.target.value })} />
              </div>
            </fieldset>
          )}
        </section>

        <section className={card} aria-labelledby="co-pay">
          <h2 id="co-pay" className="text-base font-semibold">{t.payment}</h2>
          <div className="grid gap-2" role="radiogroup" aria-labelledby="co-pay">
            {payments.map((p) => (
              <Option key={p.id} name="co-pay" checked={paymentId === p.id} onChange={() => setPaymentId(p.id)} title={p.name} detail={p.instructions ?? ''} />
            ))}
          </div>
          <div>
            <label htmlFor="co-notes" className={label}>{t.notes}</label>
            <textarea id="co-notes" rows={2} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} className={`${field} h-auto py-2.5`} />
          </div>
          {note && <p className="text-xs text-slate-500">{note}</p>}
        </section>
      </div>

      <aside className={`${card} lg:sticky lg:top-24`} aria-labelledby="co-summary">
        <h2 id="co-summary" className="text-base font-semibold">{t.summary}</h2>
        <ul className="divide-y divide-slate-100">
          {lines.map((l) => (
            <li key={`${l.product_id}:${l.variant_id ?? ''}`} className="flex items-center gap-3 py-3">
              <span className="relative shrink-0">
                <LineImage src={l.image} alt={l.name} className="size-12 rounded-lg" />
                <span className="absolute -right-1.5 -top-1.5 min-w-5 rounded-full bg-slate-700 px-1 text-center text-[11px] font-bold leading-5 text-white">{l.quantity}</span>
              </span>
              <span className="min-w-0 flex-1 text-sm">
                <span className="block truncate font-medium">{l.name}</span>
                {l.variant_name && <span className="block truncate text-xs text-slate-500">{l.variant_name}</span>}
              </span>
              <span className="text-sm tabular-nums">{money(l.price * l.quantity)}</span>
            </li>
          ))}
        </ul>
        <dl className="space-y-2 border-t border-slate-100 pt-3 text-sm">
          <div className="flex justify-between"><dt className="text-slate-600">{t.subtotal}</dt><dd className="tabular-nums">{quote ? money(subtotal) : '…'}</dd></div>
          <div className="flex justify-between"><dt className="text-slate-600">{t.shipping}</dt><dd className="tabular-nums">{fee === null ? '—' : fee === 0 ? t.free : money(fee)}</dd></div>
          <div className="flex justify-between border-t border-slate-100 pt-2 text-base font-bold"><dt>{t.total}</dt><dd className="tabular-nums">{total === null ? '—' : money(total)}</dd></div>
        </dl>
        {quoteError && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{errorText({ code: quoteError.error, name: quoteError.name, available: quoteError.available })}</p>}
        {error && (
          <p ref={errorRef} tabIndex={-1} role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 focus:outline-none">
            {errorText(error)}
          </p>
        )}
        <button
          type="submit"
          disabled={preview || sending || !quote || !!quoteError || total === null || !paymentId}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-full text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          style={{ background: config.accent }}
        >
          {sending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Lock className="size-4" aria-hidden />}
          {sending ? t.placing : total === null ? t.placeOrder : `${t.placeOrder} · ${money(total)}`}
        </button>
      </aside>
    </form>
  );
}

function Option(props: {
  name: string;
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
  icon?: React.ReactNode;
  title: string;
  detail?: string;
  right?: string;
}) {
  const { config } = useStore();
  return (
    <label
      className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3.5 transition-colors ${props.disabled ? 'cursor-not-allowed opacity-50' : 'hover:bg-slate-50'} ${props.checked ? 'bg-slate-50' : 'border-slate-200'}`}
      style={props.checked ? { borderColor: config.accent, boxShadow: `inset 0 0 0 1px ${config.accent}` } : undefined}
    >
      <input type="radio" name={props.name} checked={props.checked} disabled={props.disabled} onChange={props.onChange} className="size-4 shrink-0" style={{ accentColor: config.accent }} />
      {props.icon && <span className="text-slate-500">{props.icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-slate-900">{props.title}</span>
        {props.detail && <span className="block whitespace-pre-line text-xs text-slate-500">{props.detail}</span>}
      </span>
      {props.right && <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-900">{props.right}</span>}
    </label>
  );
}

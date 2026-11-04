'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Bell, CheckCircle2, Loader2, MessageCircle, X } from 'lucide-react';
import type { StoreProduct } from '@/lib/store/server';
import { fill } from '@/lib/store/texts';
import { useStore } from './cart';

/**
 * "Notify me when available" on a sold-out product (or variant): a dialog
 * that takes the customer's WhatsApp, adds them to the business's waitlist
 * and opens their WhatsApp with a message to the business.
 */
export function NotifyMe({ product: p, variantId = null, compact = false }: { product: StoreProduct; variantId?: string | null; compact?: boolean }) {
  const { t, config } = useStore();
  const n = t.notify;
  const uid = useId();
  const ref = useRef<HTMLDialogElement>(null);
  const soldOutVariants = p.variants.filter((v) => v.available === 0);
  const [variant, setVariant] = useState<string>(variantId ?? soldOutVariants[0]?.id ?? '');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [website, setWebsite] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ wa_url: string | null } | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- follow the variant picked outside
    if (variantId) setVariant(variantId);
  }, [variantId]);

  const item = (() => {
    const v = p.variants.find((x) => x.id === variant);
    return v ? `${p.name} (${v.name})` : p.name;
  })();

  const open = () => {
    setError(null);
    setDone(null);
    ref.current?.showModal();
  };
  const close = () => ref.current?.close();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sending) return;
    setSending(true);
    setError(null);
    const res = await fetch(`/api/public/store/${encodeURIComponent(config.slug)}/waitlist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product_id: p.id, variant_id: p.variants.length ? variant || null : null, name, phone, website }),
    }).catch(() => null);
    const body = await res?.json().catch(() => ({}));
    setSending(false);
    if (res?.ok) {
      setDone({ wa_url: body?.wa_url ?? null });
      // The customer's own message to the business (the store asked for it).
      if (body?.wa_url) window.open(body.wa_url, '_blank', 'noopener,noreferrer');
      return;
    }
    const code = res?.status === 429 ? 'rate' : (body?.error as string) ?? 'failed';
    setError((n.errors as Record<string, string>)[code] ?? n.errors.failed);
  };

  const field = 'h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-base text-slate-900 outline-none focus:border-transparent focus:ring-2';
  const ring = { ['--tw-ring-color' as string]: config.accent };

  return (
    <>
      <button
        type="button"
        onClick={open}
        className={
          compact
            ? 'flex h-9 w-full items-center justify-center gap-1.5 rounded-full border text-sm font-semibold hover:bg-slate-50'
            : 'inline-flex h-11 items-center justify-center gap-2 rounded-full border-2 px-6 text-sm font-semibold hover:bg-slate-50'
        }
        style={{ borderColor: config.accent, color: config.accent }}
      >
        <Bell className="size-4" aria-hidden /> {compact ? n.short : n.button}
      </button>

      <dialog
        ref={ref}
        aria-labelledby={`${uid}-title`}
        className="m-auto w-[calc(100%-2rem)] max-w-md rounded-3xl bg-white p-0 text-slate-900 shadow-xl backdrop:bg-slate-900/50"
        onClick={(e) => {
          if (e.target === ref.current) close();
        }}
      >
        <div className="relative p-6">
          <button type="button" onClick={close} aria-label={t.close} className="absolute right-3 top-3 inline-flex size-10 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100">
            <X className="size-5" aria-hidden />
          </button>
          {done ? (
            <div className="space-y-4 pt-2 text-center" role="status">
              <CheckCircle2 className="mx-auto size-12" style={{ color: config.accent }} aria-hidden />
              <h2 id={`${uid}-title`} className="text-lg font-bold">{n.doneTitle}</h2>
              <p className="text-sm text-slate-600">{fill(n.doneText, { product: item })}</p>
              {done.wa_url && (
                <a
                  href={done.wa_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-full text-sm font-semibold text-white hover:opacity-90"
                  style={{ background: '#25D366' }}
                >
                  <MessageCircle className="size-4" aria-hidden /> {n.openWhatsApp}
                </a>
              )}
              <button type="button" onClick={close} className="text-sm font-semibold underline underline-offset-4" style={{ color: config.accent }}>
                {t.close}
              </button>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-1 pr-10">
                <h2 id={`${uid}-title`} className="text-lg font-bold">{n.title}</h2>
                <p className="text-sm text-slate-600">{fill(n.intro, { product: item })}</p>
              </div>
              {soldOutVariants.length > 1 && (
                <div className="space-y-1.5">
                  <label htmlFor={`${uid}-variant`} className="text-sm font-medium">{n.option}</label>
                  <select id={`${uid}-variant`} value={variant} onChange={(e) => setVariant(e.target.value)} className={field} style={ring}>
                    {soldOutVariants.map((v) => (
                      <option key={v.id} value={v.id}>{v.name}</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="space-y-1.5">
                <label htmlFor={`${uid}-name`} className="text-sm font-medium">{n.name}</label>
                <input id={`${uid}-name`} autoComplete="name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} className={field} style={ring} />
              </div>
              <div className="space-y-1.5">
                <label htmlFor={`${uid}-phone`} className="text-sm font-medium">{n.phone}</label>
                <input
                  id={`${uid}-phone`}
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  required
                  maxLength={20}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  aria-describedby={`${uid}-phone-hint`}
                  aria-invalid={error === n.errors.phone}
                  className={field}
                  style={ring}
                />
                <p id={`${uid}-phone-hint`} className="text-xs text-slate-500">{n.phoneHint}</p>
              </div>
              <input type="text" name="website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} className="hidden" aria-hidden />
              {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
              <button
                type="submit"
                disabled={sending || !phone.trim()}
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-full text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
                style={{ background: config.accent }}
              >
                {sending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Bell className="size-4" aria-hidden />} {n.submit}
              </button>
            </form>
          )}
        </div>
      </dialog>
    </>
  );
}

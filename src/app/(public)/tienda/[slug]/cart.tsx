'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ImageOff, Minus, Plus, ShoppingBag, Trash2, X } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { formatMoney } from '@/lib/workspace/countries';
import { MAX_QUANTITY } from '@/lib/store/checkout';
import { fill, storeTexts, type StoreTexts } from '@/lib/store/texts';

export interface CartLine {
  product_id: string;
  variant_id: string | null;
  name: string;
  variant_name: string | null;
  /** Shown in the cart only: the server prices the order. */
  price: number;
  image: string | null;
  quantity: number;
  /** Stock when added (null = not tracked). */
  max: number | null;
}

export interface StoreConfig {
  slug: string;
  name: string;
  currency: string;
  moneyLocale: string;
  locale: 'es' | 'en';
  accent: string;
}

interface CartCtx {
  config: StoreConfig;
  t: StoreTexts;
  money: (n: number) => string;
  lines: CartLine[];
  count: number;
  subtotal: number;
  add: (line: Omit<CartLine, 'quantity'>, quantity?: number) => void;
  setQuantity: (productId: string, variantId: string | null, quantity: number) => void;
  clear: () => void;
  open: boolean;
  setOpen: (open: boolean) => void;
  ready: boolean;
}

const Ctx = createContext<CartCtx | null>(null);

export function useStore(): CartCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useStore outside StoreProvider');
  return v;
}

const keyOf = (l: { product_id: string; variant_id: string | null }) => `${l.product_id}:${l.variant_id ?? ''}`;
const storageKey = (slug: string) => `whasalia-cart:${slug}`;

function readCart(slug: string): CartLine[] {
  try {
    const raw = window.localStorage.getItem(storageKey(slug));
    const list = raw ? (JSON.parse(raw) as CartLine[]) : [];
    return Array.isArray(list) ? list.filter((l) => l && typeof l.product_id === 'string' && Number.isInteger(l.quantity) && l.quantity > 0).slice(0, 50) : [];
  } catch {
    return [];
  }
}

export function StoreProvider({ config, children }: { config: StoreConfig; children: React.ReactNode }) {
  const t = storeTexts(config.locale);
  const [lines, setLines] = useState<CartLine[]>([]);
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the cart lives in this browser's storage
    setLines(readCart(config.slug));
    setReady(true);
  }, [config.slug]);

  useEffect(() => {
    if (!ready) return;
    try {
      window.localStorage.setItem(storageKey(config.slug), JSON.stringify(lines));
    } catch {
      // Private mode / storage full: the cart still works for this visit.
    }
  }, [lines, ready, config.slug]);

  const money = useCallback((n: number) => formatMoney(n, config.currency, config.moneyLocale), [config.currency, config.moneyLocale]);

  const add = useCallback((line: Omit<CartLine, 'quantity'>, quantity = 1) => {
    setLines((prev) => {
      const cap = (q: number) => Math.min(MAX_QUANTITY, line.max ?? MAX_QUANTITY, q);
      const i = prev.findIndex((l) => keyOf(l) === keyOf(line));
      if (i === -1) return [...prev, { ...line, quantity: cap(quantity) }];
      const next = [...prev];
      next[i] = { ...next[i], ...line, quantity: cap(next[i].quantity + quantity) };
      return next;
    });
    setOpen(true);
  }, []);

  const setQuantity = useCallback((productId: string, variantId: string | null, quantity: number) => {
    setLines((prev) =>
      quantity <= 0
        ? prev.filter((l) => keyOf(l) !== `${productId}:${variantId ?? ''}`)
        : prev.map((l) => (keyOf(l) === `${productId}:${variantId ?? ''}` ? { ...l, quantity: Math.min(MAX_QUANTITY, l.max ?? MAX_QUANTITY, quantity) } : l)),
    );
  }, []);

  const clear = useCallback(() => setLines([]), []);

  const value = useMemo<CartCtx>(
    () => ({
      config,
      t,
      money,
      lines,
      count: lines.reduce((a, l) => a + l.quantity, 0),
      subtotal: Math.round(lines.reduce((a, l) => a + l.price * l.quantity, 0) * 100) / 100,
      add,
      setQuantity,
      clear,
      open,
      setOpen,
      ready,
    }),
    [config, t, money, lines, add, setQuantity, clear, open, ready],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      <CartDrawer />
    </Ctx.Provider>
  );
}

export function CartButton() {
  const { count, setOpen, t, config } = useStore();
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      aria-label={fill(t.openCart, { n: count })}
      className="relative inline-flex size-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-800 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
      style={{ ['--tw-ring-color' as string]: config.accent }}
    >
      <ShoppingBag className="size-5" aria-hidden />
      {count > 0 && (
        <span className="absolute -right-1 -top-1 min-w-5 rounded-full px-1 text-center text-[11px] font-bold leading-5 text-white" style={{ background: config.accent }}>
          {count}
        </span>
      )}
    </button>
  );
}

export function LineImage({ src, alt, className }: { src: string | null; alt: string; className?: string }) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element -- product photos come from any storage host
    <img src={src} alt={alt} className={`${className ?? ''} object-cover`} loading="lazy" />
  ) : (
    <span className={`${className ?? ''} flex items-center justify-center bg-slate-100 text-slate-400`}>
      <ImageOff className="size-5" aria-hidden />
    </span>
  );
}

function CartDrawer() {
  const { lines, open, setOpen, t, money, subtotal, setQuantity, config, count } = useStore();
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent side="right" showCloseButton={false} className="w-full gap-0 border-slate-200 bg-white p-0 text-slate-900 data-[side=right]:w-full sm:max-w-md data-[side=right]:sm:max-w-md">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <SheetTitle className="text-base font-semibold text-slate-900">{t.cart}</SheetTitle>
            <SheetDescription className="sr-only">{fill(t.openCart, { n: count })}</SheetDescription>
          </div>
          <button type="button" onClick={() => setOpen(false)} aria-label={t.close} className="inline-flex size-9 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-900">
            <X className="size-5" aria-hidden />
          </button>
        </div>

        {lines.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
            <ShoppingBag className="size-10 text-slate-300" aria-hidden />
            <p className="text-sm text-slate-600">{t.emptyCart}</p>
            <button type="button" onClick={() => setOpen(false)} className="text-sm font-semibold underline underline-offset-4" style={{ color: config.accent }}>
              {t.keepShopping}
            </button>
          </div>
        ) : (
          <>
            <ul className="flex-1 divide-y divide-slate-100 overflow-y-auto px-5">
              {lines.map((l) => (
                <li key={`${l.product_id}:${l.variant_id ?? ''}`} className="flex gap-3 py-4">
                  <LineImage src={l.image} alt={l.name} className="size-16 shrink-0 rounded-lg" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-900">{l.name}</p>
                    {l.variant_name && <p className="truncate text-xs text-slate-500">{l.variant_name}</p>}
                    <p className="mt-0.5 text-sm text-slate-700">{money(l.price)}</p>
                    <div className="mt-2 flex items-center gap-2">
                      <div className="inline-flex items-center rounded-full border border-slate-200">
                        <button type="button" aria-label={t.decrease} onClick={() => setQuantity(l.product_id, l.variant_id, l.quantity - 1)} className="inline-flex size-8 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100">
                          <Minus className="size-3.5" aria-hidden />
                        </button>
                        <span className="w-7 text-center text-sm font-medium tabular-nums" aria-live="polite">{l.quantity}</span>
                        <button
                          type="button"
                          aria-label={t.increase}
                          disabled={l.quantity >= (l.max ?? MAX_QUANTITY)}
                          onClick={() => setQuantity(l.product_id, l.variant_id, l.quantity + 1)}
                          className="inline-flex size-8 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                        >
                          <Plus className="size-3.5" aria-hidden />
                        </button>
                      </div>
                      <button type="button" aria-label={`${t.remove}: ${l.name}`} onClick={() => setQuantity(l.product_id, l.variant_id, 0)} className="ml-auto inline-flex size-8 items-center justify-center rounded-full text-slate-400 hover:bg-red-50 hover:text-red-600">
                        <Trash2 className="size-4" aria-hidden />
                      </button>
                    </div>
                  </div>
                  <p className="shrink-0 text-sm font-semibold tabular-nums text-slate-900">{money(l.price * l.quantity)}</p>
                </li>
              ))}
            </ul>
            <div className="space-y-3 border-t border-slate-200 px-5 py-4">
              <div className="flex items-center justify-between text-base font-semibold">
                <span>{t.subtotal}</span>
                <span className="tabular-nums">{money(subtotal)}</span>
              </div>
              <p className="text-xs text-slate-500">{t.shippingAtCheckout}</p>
              <Link
                href={`/tienda/${encodeURIComponent(config.slug)}/checkout`}
                onClick={() => setOpen(false)}
                className="flex h-12 w-full items-center justify-center rounded-full text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                style={{ background: config.accent }}
              >
                {t.goCheckout}
              </Link>
              <button type="button" onClick={() => setOpen(false)} className="w-full text-center text-sm text-slate-600 hover:text-slate-900">
                {t.keepShopping}
              </button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

'use client';

import { useState } from 'react';
import { Minus, Plus, ShoppingBag } from 'lucide-react';
import { MAX_QUANTITY } from '@/lib/store/checkout';
import type { StoreProduct } from '@/lib/store/server';
import { fill } from '@/lib/store/texts';
import { useStore } from '../../cart';
import { NotifyMe } from '../../notify-me';

/** Price, variant picker, quantity and "Add to cart" (opens the drawer). */
export function BuyBox({ product: p }: { product: StoreProduct }) {
  const { t, money, add, config } = useStore();
  const [variantId, setVariantId] = useState<string | null>(p.variants.find((v) => v.available !== 0)?.id ?? null);
  const [qty, setQty] = useState(1);
  const variant = p.variants.find((v) => v.id === variantId) ?? null;
  const price = variant?.price ?? p.price;
  const available = p.variants.length ? (variant?.available ?? null) : p.available;
  const soldOut = p.variants.length ? !variant || variant.available === 0 : p.available === 0;
  const max = Math.min(MAX_QUANTITY, available ?? MAX_QUANTITY);
  const label = p.variants.length ? (variant?.stock_label ?? null) : p.stock_label;

  return (
    <div className="space-y-4">
      <p className="flex items-baseline gap-3">
        <span className="text-2xl font-bold text-slate-900">{money(price)}</span>
        {p.compare_at_price && p.compare_at_price > price && <span className="text-base text-slate-400 line-through">{money(p.compare_at_price)}</span>}
      </p>

      {p.variants.length > 0 && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-slate-800">{t.chooseOption}</legend>
          <div className="flex flex-wrap gap-2">
            {p.variants.map((v) => {
              const active = v.id === variantId;
              const out = v.available === 0;
              return (
                <button
                  key={v.id}
                  type="button"
                  aria-pressed={active}
                  // With a waitlist a sold-out option can be picked to ask for it.
                  disabled={out && !p.waitlist}
                  onClick={() => {
                    setVariantId(v.id);
                    setQty(1);
                  }}
                  className={`rounded-full border px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:line-through disabled:opacity-40 ${out ? 'border-dashed' : ''} ${active ? 'text-white' : 'border-slate-300 bg-white text-slate-800 hover:bg-slate-50'}`}
                  style={active ? { background: config.accent, borderColor: config.accent } : undefined}
                >
                  {v.name}
                  {out && <span className="sr-only"> ({t.soldOut})</span>}
                </button>
              );
            })}
          </div>
        </fieldset>
      )}

      {soldOut ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="inline-flex rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700">{t.soldOut}</p>
          {p.waitlist && <NotifyMe product={p} variantId={variant?.id ?? null} />}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex items-center rounded-full border border-slate-300" role="group" aria-label={t.quantity}>
            <button type="button" aria-label={t.decrease} disabled={qty <= 1} onClick={() => setQty((q) => Math.max(1, q - 1))} className="inline-flex size-11 items-center justify-center rounded-full text-slate-700 hover:bg-slate-100 disabled:opacity-40">
              <Minus className="size-4" aria-hidden />
            </button>
            <span className="w-8 text-center font-semibold tabular-nums" aria-live="polite">{qty}</span>
            <button type="button" aria-label={t.increase} disabled={qty >= max} onClick={() => setQty((q) => Math.min(max, q + 1))} className="inline-flex size-11 items-center justify-center rounded-full text-slate-700 hover:bg-slate-100 disabled:opacity-40">
              <Plus className="size-4" aria-hidden />
            </button>
          </div>
          <button
            type="button"
            onClick={() =>
              add({ product_id: p.id, variant_id: variant?.id ?? null, name: p.name, variant_name: variant?.name ?? null, price, image: p.images[0] ?? null, max: available }, qty)
            }
            className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-full px-6 text-sm font-semibold text-white shadow-sm hover:opacity-90 sm:flex-none"
            style={{ background: config.accent }}
          >
            <ShoppingBag className="size-4" aria-hidden /> {t.addToCart}
          </button>
          {label && (
            <p className={`w-full text-sm font-medium ${label.kind === 'low' || label.low ? 'text-amber-700' : 'text-slate-600'}`}>
              {label.kind === 'low' ? t.almostGone : fill(t.left, { n: label.n })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

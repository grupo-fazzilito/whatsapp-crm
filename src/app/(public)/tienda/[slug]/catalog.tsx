'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { CalendarCheck, Clock, Plus, Search, Sparkles } from 'lucide-react';
import type { StoreCategory, StoreProduct } from '@/lib/store/server';
import type { StoreService } from '@/lib/store/services';
import { fill } from '@/lib/store/texts';
import { LineImage, useStore } from './cart';
import { NotifyMe } from './notify-me';

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function StoreCatalog({ products, categories, services }: { products: StoreProduct[]; categories: StoreCategory[]; services: StoreService[] }) {
  const { t } = useStore();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<string | null>(null);

  const shown = useMemo(() => {
    const needle = norm(q.trim());
    return products.filter((p) => (!cat || p.category_id === cat) && (!needle || norm(`${p.name} ${p.description ?? ''}`).includes(needle)));
  }, [products, q, cat]);
  const shownServices = useMemo(() => {
    const needle = norm(q.trim());
    return cat ? [] : services.filter((s) => !needle || norm(`${s.name} ${s.description ?? ''} ${s.category ?? ''}`).includes(needle));
  }, [services, q, cat]);

  if (!products.length && !services.length) return <p className="rounded-2xl bg-white p-10 text-center text-slate-600 ring-1 ring-slate-200">{t.emptyStore}</p>;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <label className="relative block sm:w-72">
          <span className="sr-only">{products.length ? t.search : t.searchServices}</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={products.length ? t.search : t.searchServices}
            className="h-11 w-full rounded-full border border-slate-200 bg-white pl-9 pr-4 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none"
          />
        </label>
        {categories.length > 0 && (
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0" role="group" aria-label={t.all}>
            <Chip active={!cat} onClick={() => setCat(null)}>{t.all}</Chip>
            {categories.map((c) => (
              <Chip key={c.id} active={cat === c.id} onClick={() => setCat(c.id)}>{c.name}</Chip>
            ))}
          </div>
        )}
      </div>

      {shown.length === 0 && shownServices.length === 0 ? (
        <p className="py-10 text-center text-sm text-slate-600">{t.noProducts}</p>
      ) : (
        <>
          {shown.length > 0 && (
            <section aria-labelledby="store-products" className="space-y-3">
              {services.length > 0 && <h2 id="store-products" className="text-lg font-semibold">{t.products}</h2>}
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
                {shown.map((p) => (
                  <li key={p.id}>
                    <ProductCard product={p} />
                  </li>
                ))}
              </ul>
            </section>
          )}
          {shownServices.length > 0 && (
            <section aria-labelledby="store-services" className="space-y-3">
              {products.length > 0 && <h2 id="store-services" className="text-lg font-semibold">{t.services}</h2>}
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {shownServices.map((s) => (
                  <li key={s.id}>
                    <ServiceCard service={s} />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  const { config } = useStore();
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`h-9 shrink-0 rounded-full border px-4 text-sm font-medium transition-colors ${active ? 'text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'}`}
      style={active ? { background: config.accent, borderColor: config.accent } : undefined}
    >
      {children}
    </button>
  );
}

function ProductCard({ product: p }: { product: StoreProduct }) {
  const { t, money, add, config } = useStore();
  const soldOut = p.variants.length ? p.variants.every((v) => v.available === 0) : p.available === 0;
  const href = `/tienda/${encodeURIComponent(config.slug)}/producto/${p.id}`;
  const fromPrice = p.variants.length ? Math.min(...p.variants.map((v) => v.price)) : p.price;
  const label = p.variants.length ? null : p.stock_label;
  const lowStock = !!label && (label.kind === 'low' || label.low);
  return (
    <article className="group relative flex h-full flex-col overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200 transition-shadow hover:shadow-md">
      <Link href={href} className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset" style={{ ['--tw-ring-color' as string]: config.accent }}>
        <div className="relative">
          <LineImage src={p.images[0] ?? null} alt={p.name} className="aspect-square w-full" />
          {soldOut ? (
            <span className="absolute left-2 top-2 rounded-full bg-slate-900/80 px-2 py-0.5 text-[11px] font-semibold text-white">{t.soldOut}</span>
          ) : lowStock ? (
            <span className="absolute left-2 top-2 rounded-full bg-amber-500 px-2 py-0.5 text-[11px] font-semibold text-white">{t.almostGone}</span>
          ) : p.is_featured ? (
            <span className="absolute left-2 top-2 rounded-full px-2 py-0.5 text-[11px] font-semibold text-white" style={{ background: config.accent }}>{t.featured}</span>
          ) : null}
        </div>
        <div className="space-y-1 p-3">
          <h2 className="line-clamp-2 text-sm font-medium text-slate-900">{p.name}</h2>
          <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
            <span className="font-semibold text-slate-900">{money(fromPrice)}</span>
            {p.compare_at_price && p.compare_at_price > fromPrice && <span className="text-xs text-slate-400 line-through">{money(p.compare_at_price)}</span>}
          </p>
          {label?.kind === 'exact' && <p className={`text-xs ${label.low ? 'text-amber-700' : 'text-slate-500'}`}>{fill(t.left, { n: label.n })}</p>}
        </div>
      </Link>
      {soldOut && p.waitlist && (
        <div className="mt-auto px-3 pb-3">
          <NotifyMe product={p} compact />
        </div>
      )}
      {!soldOut && (
        <div className="mt-auto px-3 pb-3">
          {p.variants.length ? (
            <Link href={href} className="flex h-9 w-full items-center justify-center rounded-full border text-sm font-semibold" style={{ borderColor: config.accent, color: config.accent }}>
              {t.choose}
            </Link>
          ) : (
            <button
              type="button"
              onClick={() => add({ product_id: p.id, variant_id: null, name: p.name, variant_name: null, price: p.price, image: p.images[0] ?? null, max: p.available })}
              className="flex h-9 w-full items-center justify-center gap-1.5 rounded-full text-sm font-semibold text-white hover:opacity-90"
              style={{ background: config.accent }}
            >
              <Plus className="size-4" aria-hidden /> {t.add}
            </button>
          )}
        </div>
      )}
    </article>
  );
}

function ServiceCard({ service: s }: { service: StoreService }) {
  const { t, money, config } = useStore();
  const href = `/tienda/${encodeURIComponent(config.slug)}/servicio/${s.id}`;
  const price = s.price > 0 ? (s.price_is_from ? fill(t.from, { price: money(s.price) }) : money(s.price)) : null;
  return (
    <article className="flex h-full gap-3 overflow-hidden rounded-2xl bg-white p-3 ring-1 ring-slate-200 transition-shadow hover:shadow-md">
      {s.image_url ? (
        <LineImage src={s.image_url} alt={s.name} className="size-24 shrink-0 rounded-xl" />
      ) : (
        <span className="flex size-24 shrink-0 items-center justify-center rounded-xl text-white" style={{ background: config.accent }} aria-hidden>
          <Sparkles className="size-8" />
        </span>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <h3 className="line-clamp-2 text-sm font-semibold text-slate-900">{s.name}</h3>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
          <span className="inline-flex items-center gap-1"><Clock className="size-3.5" aria-hidden /> {fill(t.minutes, { n: s.duration_minutes })}</span>
          {s.category && <span>· {s.category}</span>}
        </p>
        {price && <p className="mt-1 text-sm font-semibold text-slate-900">{price}</p>}
        <Link
          href={href}
          className="mt-auto inline-flex h-9 items-center justify-center gap-1.5 self-start rounded-full px-4 text-sm font-semibold text-white hover:opacity-90"
          style={{ background: config.accent }}
        >
          <CalendarCheck className="size-4" aria-hidden /> {s.booking === 'schedule' ? t.book : t.hire}
        </Link>
      </div>
    </article>
  );
}

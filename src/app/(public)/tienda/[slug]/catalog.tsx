'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Plus, Search } from 'lucide-react';
import type { StoreCategory, StoreProduct } from '@/lib/store/server';
import { LineImage, useStore } from './cart';

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function StoreCatalog({ products, categories }: { products: StoreProduct[]; categories: StoreCategory[] }) {
  const { t } = useStore();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<string | null>(null);

  const shown = useMemo(() => {
    const needle = norm(q.trim());
    return products.filter((p) => (!cat || p.category_id === cat) && (!needle || norm(`${p.name} ${p.description ?? ''}`).includes(needle)));
  }, [products, q, cat]);

  if (!products.length) return <p className="rounded-2xl bg-white p-10 text-center text-slate-600 ring-1 ring-slate-200">{t.emptyStore}</p>;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <label className="relative block sm:w-72">
          <span className="sr-only">{t.search}</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t.search}
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

      {shown.length === 0 ? (
        <p className="py-10 text-center text-sm text-slate-600">{t.noProducts}</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
          {shown.map((p) => (
            <li key={p.id}>
              <ProductCard product={p} />
            </li>
          ))}
        </ul>
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
  return (
    <article className="group relative flex h-full flex-col overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200 transition-shadow hover:shadow-md">
      <Link href={href} className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset" style={{ ['--tw-ring-color' as string]: config.accent }}>
        <div className="relative">
          <LineImage src={p.images[0] ?? null} alt={p.name} className="aspect-square w-full" />
          {soldOut ? (
            <span className="absolute left-2 top-2 rounded-full bg-slate-900/80 px-2 py-0.5 text-[11px] font-semibold text-white">{t.soldOut}</span>
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
        </div>
      </Link>
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

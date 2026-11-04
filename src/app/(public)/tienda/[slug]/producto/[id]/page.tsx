import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { followSlug } from '@/lib/store/follow-slug';
import { ChevronLeft } from 'lucide-react';
import { isUuid } from '@/lib/workspace/constants';
import { loadStore, loadStoreCatalog, storeMoney } from '@/lib/store/server';
import { storePath } from '@/lib/store/settings';
import { fill, storeTexts } from '@/lib/store/texts';
import { siteUrl } from '@/lib/real-estate/listing/url';
import { Gallery } from '@/app/(public)/p/[slug]/[id]/gallery';
import { BuyBox } from './buy-box';

type Props = { params: Promise<{ slug: string; id: string }> };

async function load(slug: string, id: string) {
  if (!isUuid(id)) return null;
  const s = await loadStore(slug);
  if (!s) return null;
  const { products } = await loadStoreCatalog(s.workspace, id);
  return products[0] ? { s, product: products[0] } : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, id } = await params;
  const data = await load(slug, id);
  if (!data) return { title: 'Not found', robots: { index: false } };
  const { s, product } = data;
  const money = storeMoney(s.workspace);
  const description = [money(product.price), product.description?.slice(0, 150)].filter(Boolean).join(' · ');
  const url = `${siteUrl()}${storePath(s.workspace.slug)}/producto/${product.id}`;
  return {
    title: `${product.name} · ${s.workspace.name}`,
    description,
    alternates: { canonical: url },
    openGraph: { title: product.name, description, url, images: product.images.slice(0, 1), type: 'website' },
    robots: s.preview ? { index: false, follow: false } : undefined,
  };
}

export default async function StoreProductPage({ params }: Props) {
  const { slug, id } = await params;
  const data = await load(slug, id);
  if (!data) notFound();
  followSlug(slug, data.s.workspace.slug, `/producto/${id}`);
  const { s, product } = data;
  const t = storeTexts(s.workspace.locale);
  return (
    <div className="space-y-4">
      <Link href={storePath(s.workspace.slug)} className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900">
        <ChevronLeft className="size-4" aria-hidden /> {t.back}
      </Link>
      <div className="grid gap-6 rounded-3xl bg-white p-4 ring-1 ring-slate-200 sm:p-6 lg:grid-cols-2 lg:gap-10">
        <Gallery images={product.images} name={product.name} labels={{ ...t.gallery, gallery: fill(t.gallery.gallery, { name: product.name }) }} />
        <div className="space-y-4">
          <h1 className="text-2xl font-bold text-slate-900">{product.name}</h1>
          <BuyBox product={product} />
          {product.description && <p className="whitespace-pre-line text-sm leading-relaxed text-slate-700">{product.description}</p>}
        </div>
      </div>
    </div>
  );
}

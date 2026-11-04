import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { followSlug } from '@/lib/store/follow-slug';
import { loadStore, loadStoreCatalog } from '@/lib/store/server';
import { siteUrl } from '@/lib/real-estate/listing/url';
import { storePath } from '@/lib/store/settings';
import { loadStoreServices } from '@/lib/store/services';
import { StoreCatalog } from './catalog';

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const s = await loadStore(slug);
  if (!s) return { title: 'Not found', robots: { index: false } };
  const ws = s.workspace;
  const description = s.store.tagline ?? ws.description ?? undefined;
  const image = s.store.banner_url ?? ws.logo_url ?? undefined;
  return {
    title: ws.name,
    description,
    alternates: { canonical: siteUrl() + storePath(ws.slug) },
    openGraph: { title: ws.name, description, url: siteUrl() + storePath(ws.slug), images: image ? [image] : undefined, type: 'website' },
    robots: s.preview ? { index: false, follow: false } : undefined,
  };
}

export default async function StorePage({ params }: Props) {
  const { slug } = await params;
  const s = await loadStore(slug);
  if (!s) notFound();
  followSlug(slug, s.workspace.slug, '');
  const [{ products, categories }, services] = await Promise.all([loadStoreCatalog(s.workspace), loadStoreServices(s.workspace)]);
  const intro = s.store.tagline ?? s.workspace.description;
  return (
    <>
      {(s.store.banner_url || intro) && (
        <section className="mb-6 overflow-hidden rounded-3xl bg-white ring-1 ring-slate-200">
          {s.store.banner_url && (
            // eslint-disable-next-line @next/next/no-img-element -- banner from storage
            <img src={s.store.banner_url} alt="" className="aspect-[3/1] w-full object-cover sm:aspect-[4/1]" />
          )}
          {intro && (
            <div className="px-5 py-4 sm:px-6">
              <h1 className="text-xl font-bold sm:text-2xl">{s.workspace.name}</h1>
              <p className="mt-1 text-sm text-slate-600">{intro}</p>
            </div>
          )}
        </section>
      )}
      {!s.store.banner_url && !intro && <h1 className="mb-4 text-2xl font-bold">{s.workspace.name}</h1>}
      <StoreCatalog products={products} categories={categories} services={services} />
    </>
  );
}

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft, Clock } from 'lucide-react';
import { isUuid } from '@/lib/workspace/constants';
import { loadCheckoutOptions, loadStore, storeMoney } from '@/lib/store/server';
import { loadStoreServices, storeBookingFields } from '@/lib/store/services';
import { storePath } from '@/lib/store/settings';
import { fill, storeTexts } from '@/lib/store/texts';
import { siteUrl } from '@/lib/real-estate/listing/url';
import { LineImage } from '../../cart';
import { ServiceBooking } from './service-booking';

type Props = { params: Promise<{ slug: string; id: string }> };

async function load(slug: string, id: string) {
  if (!isUuid(id)) return null;
  const s = await loadStore(slug);
  if (!s) return null;
  const service = (await loadStoreServices(s.workspace, id))[0];
  return service ? { s, service } : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, id } = await params;
  const data = await load(slug, id);
  if (!data) return { title: 'Not found', robots: { index: false } };
  const { s, service } = data;
  const url = `${siteUrl()}${storePath(s.workspace.slug)}/servicio/${service.id}`;
  const description = [service.price > 0 ? storeMoney(s.workspace)(service.price) : null, service.description?.slice(0, 150)].filter(Boolean).join(' · ');
  return {
    title: `${service.name} · ${s.workspace.name}`,
    description,
    alternates: { canonical: url },
    openGraph: { title: service.name, description, url, images: service.image_url ? [service.image_url] : undefined, type: 'website' },
    robots: s.preview ? { index: false, follow: false } : undefined,
  };
}

export default async function StoreServicePage({ params }: Props) {
  const { slug, id } = await params;
  const data = await load(slug, id);
  if (!data) notFound();
  const { s, service } = data;
  const t = storeTexts(s.workspace.locale);
  const money = storeMoney(s.workspace);
  const { payments } = await loadCheckoutOptions(s.workspace.id);
  const price = service.price > 0 ? (service.price_is_from ? fill(t.from, { price: money(service.price) }) : money(service.price)) : null;
  return (
    <div className="space-y-4">
      <Link href={storePath(s.workspace.slug)} className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900">
        <ChevronLeft className="size-4" aria-hidden /> {t.back}
      </Link>
      <div className="grid gap-6 lg:grid-cols-[1fr_400px] lg:items-start">
        <section className="space-y-4 rounded-3xl bg-white p-5 ring-1 ring-slate-200 sm:p-6">
          {service.image_url && <LineImage src={service.image_url} alt={service.name} className="aspect-video w-full rounded-2xl" />}
          <h1 className="text-2xl font-bold">{service.name}</h1>
          <p className="flex flex-wrap items-center gap-3 text-sm text-slate-600">
            <span className="inline-flex items-center gap-1"><Clock className="size-4" aria-hidden /> {fill(t.minutes, { n: service.duration_minutes })}</span>
            {price && <span className="text-lg font-bold text-slate-900">{price}</span>}
          </p>
          {service.description && <p className="whitespace-pre-line text-sm leading-relaxed text-slate-700">{service.description}</p>}
        </section>
        <ServiceBooking
          service={service}
          preview={s.preview}
          dialCode={s.dialCode}
          payments={payments}
          fields={storeBookingFields(s.workspace)}
        />
      </div>
    </div>
  );
}

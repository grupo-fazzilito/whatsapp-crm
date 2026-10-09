import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import {
  Bath,
  BedDouble,
  Building2,
  CalendarDays,
  Car,
  ExternalLink,
  Home,
  Layers,
  MapPin,
  MessageCircle,
  PlayCircle,
  Rotate3d,
  Ruler,
  Tag,
  Wallet,
} from 'lucide-react';
import { createTranslator } from '@/i18n/translate';
import { productAttributesFor } from '@/lib/catalog/attributes';
import { formatMoney, moneyLocale } from '@/lib/workspace/countries';
import { loadPublicListing, type PublicListing } from '@/lib/real-estate/listing/public';
import { propertyUrl, siteUrl } from '@/lib/real-estate/listing/url';
import { coordsFrom, googleMapsUrl, osmEmbedUrl, osmLink } from '@/lib/real-estate/listing/geo';
import { listingStatusOf, safeHttpUrl, waMeLink } from '@/lib/real-estate/listing/status';
import { Gallery } from './gallery';
import { PrintButton, VisitButton } from './actions';

type Props = { params: Promise<{ slug: string; id: string }> };

function optionLabel(listing: PublicListing, key: string): string | null {
  const v = listing.product.attributes[key];
  if (typeof v !== 'string' || !v) return null;
  const f = productAttributesFor(listing.workspace.industry, listing.workspace.settings).find((x) => x.key === key);
  return f?.options?.find((o) => o.value === v)?.label[listing.workspace.locale] ?? v;
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** Whole amounts without cents ("S/ 450,000", "US$ 350,000"), others as usual. */
function money(amount: number, currency: string, ws: PublicListing['workspace']): string {
  return formatMoney(amount, currency, moneyLocale(ws), { whole: true });
}

function priceText(listing: PublicListing, t: ReturnType<typeof createTranslator>): string {
  const { product, workspace } = listing;
  if (product.price === null) return t('realestate.public.priceOnRequest');
  const base = money(product.price, product.currency, workspace);
  return listing.product.attributes.operation === 'rent' ? `${base} ${t('realestate.public.perMonth')}` : base;
}

/** "Departamento · 3 dorm. · 120 m² · Miraflores" */
function summary(listing: PublicListing, t: ReturnType<typeof createTranslator>): string {
  const a = listing.product.attributes;
  const parts = [
    optionLabel(listing, 'property_type'),
    num(a.bedrooms) !== null ? t('realestate.public.bedroomsShort', { n: num(a.bedrooms)! }) : null,
    num(a.area_m2) !== null ? `${num(a.area_m2)} m²` : null,
    typeof a.zone === 'string' && a.zone.trim() ? a.zone.trim() : null,
  ];
  return parts.filter(Boolean).join(' · ');
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, id } = await params;
  const listing = await loadPublicListing(slug, id);
  if (!listing) return { title: 'Not found', robots: { index: false, follow: false } };
  const t = createTranslator(listing.workspace.locale);
  const title = `${listing.product.name} — ${priceText(listing, t)}`;
  const desc = [summary(listing, t), listing.product.description?.replace(/\s+/g, ' ').trim()]
    .filter(Boolean)
    .join('. ')
    .slice(0, 200);
  const url = propertyUrl(listing.workspace, listing.product);
  const image = listing.product.images[0];
  return {
    metadataBase: new URL(siteUrl()),
    title: { absolute: `${title} | ${listing.workspace.name}` },
    description: desc,
    alternates: { canonical: url },
    robots: listing.noindex ? { index: false, follow: false } : { index: true, follow: true },
    openGraph: {
      type: 'website',
      url,
      title,
      description: desc,
      siteName: listing.workspace.name,
      locale: listing.workspace.locale === 'en' ? 'en_US' : `es_${listing.workspace.country ?? 'PE'}`,
      images: image ? [{ url: image, alt: listing.product.name }] : [],
    },
    twitter: {
      card: image ? 'summary_large_image' : 'summary',
      title,
      description: desc,
      images: image ? [image] : [],
    },
  };
}

export default async function PropertyPage({ params }: Props) {
  const { slug, id } = await params;
  const listing = await loadPublicListing(slug, id);
  if (!listing) notFound();

  const { product, workspace } = listing;
  const locale = workspace.locale;
  const t = createTranslator(locale);
  const a = product.attributes;
  const fields = productAttributesFor(workspace.industry, workspace.settings);
  const nf = new Intl.NumberFormat(moneyLocale(workspace));
  const url = propertyUrl(workspace, product);
  const status = listingStatusOf(a);
  const coords = coordsFrom(a);
  const address = [typeof a.address === 'string' ? a.address.trim() : '', typeof a.zone === 'string' ? a.zone.trim() : '']
    .filter(Boolean)
    .join(', ');
  const video = safeHttpUrl(a.video_url);
  const tour = safeHttpUrl(a.virtual_tour_url);
  const amenitiesField = fields.find((f) => f.key === 'amenities');
  const amenities = (Array.isArray(a.amenities) ? a.amenities : [])
    .filter((v): v is string => typeof v === 'string')
    .map((v) => amenitiesField?.options?.find((o) => o.value === v)?.label[locale] ?? v);
  const fee = num(a.maintenance_fee);

  const facts: { icon: React.ReactNode; label: string; value: string }[] = [];
  const push = (icon: React.ReactNode, label: string, value: string | null) => {
    if (value) facts.push({ icon, label, value });
  };
  push(<Tag className="size-5" aria-hidden />, t('realestate.public.facts.operation'), optionLabel(listing, 'operation'));
  push(<Home className="size-5" aria-hidden />, t('realestate.public.facts.type'), optionLabel(listing, 'property_type'));
  push(<Ruler className="size-5" aria-hidden />, t('realestate.public.facts.area'), num(a.area_m2) !== null ? `${nf.format(num(a.area_m2)!)} m²` : null);
  push(<BedDouble className="size-5" aria-hidden />, t('realestate.public.facts.bedrooms'), num(a.bedrooms) !== null ? nf.format(num(a.bedrooms)!) : null);
  push(<Bath className="size-5" aria-hidden />, t('realestate.public.facts.bathrooms'), num(a.bathrooms) !== null ? nf.format(num(a.bathrooms)!) : null);
  push(<Car className="size-5" aria-hidden />, t('realestate.public.facts.parking'), num(a.parking) !== null ? nf.format(num(a.parking)!) : null);
  push(<Layers className="size-5" aria-hidden />, t('realestate.public.facts.floor'), num(a.floor) !== null ? String(num(a.floor)) : null);
  push(
    <Wallet className="size-5" aria-hidden />,
    t('realestate.public.facts.maintenance'),
    fee !== null ? `${money(fee, workspace.currency, workspace)} ${t('realestate.public.perMonth')}` : null,
  );
  push(<CalendarDays className="size-5" aria-hidden />, t('realestate.public.facts.yearBuilt'), num(a.year_built) !== null ? String(num(a.year_built)) : null);

  const waHref = listing.whatsapp ? waMeLink(listing.whatsapp, t('realestate.public.waMessage', { name: product.name, url })) : null;
  const visitWaHref = listing.whatsapp ? waMeLink(listing.whatsapp, t('realestate.public.visitMessage', { name: product.name, url })) : null;

  const btnBase =
    'inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-5 text-base font-semibold transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-offset-2 disabled:opacity-60';
  const waBtn = `${btnBase} bg-[#128C4A] text-white hover:bg-[#0f7a40] focus-visible:ring-emerald-500`;
  const visitBtn = `${btnBase} border-2 border-slate-900 bg-white text-slate-900 hover:bg-slate-100 focus-visible:ring-slate-500`;
  const linkBtn =
    'inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 px-4 text-sm font-medium text-slate-900 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-emerald-500';
  const hasCta = !!(waHref || listing.webchatKey);

  return (
    <div lang={locale} className="min-h-screen bg-white text-slate-900 [color-scheme:light] print:min-h-0">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
          {workspace.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={workspace.logo_url} alt="" className="size-9 rounded-lg object-cover" />
          ) : (
            <span className="flex size-9 items-center justify-center rounded-lg bg-emerald-700 text-white" aria-hidden>
              <Building2 className="size-5" />
            </span>
          )}
          <p className="truncate font-semibold">{workspace.name}</p>
        </div>
      </header>

      <main className={`mx-auto grid max-w-5xl gap-8 px-4 py-6 lg:grid-cols-[1fr_320px] ${hasCta ? 'pb-28 lg:pb-10' : ''} print:block print:pb-0`}>
        <div className="grid min-w-0 content-start gap-8">
          <Gallery
            images={product.images}
            name={product.name}
            labels={{
              gallery: t('realestate.public.gallery'),
              prev: t('realestate.public.prev'),
              next: t('realestate.public.next'),
              photo: t('realestate.public.photo'),
              noPhotos: t('realestate.public.noPhotos'),
            }}
          />

          <section className="grid gap-2" aria-labelledby="prop-title">
            <div className="flex flex-wrap items-center gap-2">
              {optionLabel(listing, 'operation') && (
                <span className="rounded-full bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-800 ring-1 ring-emerald-200">
                  {optionLabel(listing, 'operation')}
                </span>
              )}
              {status === 'reserved' && (
                <span className="rounded-full bg-amber-400 px-3 py-1 text-sm font-semibold text-black">{t('realestate.listing.status.reserved')}</span>
              )}
              {product.category && <span className="text-sm text-slate-600">{product.category}</span>}
            </div>
            <h1 id="prop-title" className="text-2xl font-bold leading-tight sm:text-3xl">
              {product.name}
            </h1>
            {address && (
              <p className="flex items-start gap-1.5 text-slate-700">
                <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden />
                {address}
              </p>
            )}
            <p className="mt-1 text-3xl font-extrabold tracking-tight text-emerald-800">{priceText(listing, t)}</p>
          </section>

          {facts.length > 0 && (
            <section aria-labelledby="prop-facts" className="grid gap-3">
              <h2 id="prop-facts" className="text-lg font-semibold">
                {t('realestate.public.facts.title')}
              </h2>
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {facts.map((f) => (
                  <div key={f.label} className="flex items-center gap-3 rounded-xl border border-slate-200 p-3 print:break-inside-avoid">
                    <span className="text-emerald-700">{f.icon}</span>
                    <span className="min-w-0">
                      <dt className="text-xs text-slate-600">{f.label}</dt>
                      <dd className="truncate font-semibold">{f.value}</dd>
                    </span>
                  </div>
                ))}
              </dl>
            </section>
          )}

          {product.description && (
            <section aria-labelledby="prop-desc" className="grid gap-2">
              <h2 id="prop-desc" className="text-lg font-semibold">
                {t('realestate.public.description')}
              </h2>
              <p className="whitespace-pre-line leading-relaxed text-slate-800">{product.description}</p>
            </section>
          )}

          {amenities.length > 0 && (
            <section aria-labelledby="prop-amen" className="grid gap-3">
              <h2 id="prop-amen" className="text-lg font-semibold">
                {t('realestate.public.amenities')}
              </h2>
              <ul className="flex flex-wrap gap-2">
                {amenities.map((am) => (
                  <li key={am} className="rounded-full bg-slate-100 px-3 py-1.5 text-sm text-slate-800">
                    {am}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {(video || tour) && (
            <section aria-labelledby="prop-media" className="grid gap-3 print:hidden">
              <h2 id="prop-media" className="text-lg font-semibold">
                {t('realestate.public.media')}
              </h2>
              <div className="flex flex-wrap gap-2">
                {video && (
                  <a href={video} target="_blank" rel="noopener noreferrer" className={linkBtn}>
                    <PlayCircle className="size-4" aria-hidden />
                    {t('realestate.public.video')}
                    <ExternalLink className="size-3.5 opacity-70" aria-hidden />
                  </a>
                )}
                {tour && (
                  <a href={tour} target="_blank" rel="noopener noreferrer" className={linkBtn}>
                    <Rotate3d className="size-4" aria-hidden />
                    {t('realestate.public.tour')}
                    <ExternalLink className="size-3.5 opacity-70" aria-hidden />
                  </a>
                )}
              </div>
            </section>
          )}

          {(coords || address) && (
            <section aria-labelledby="prop-map" className="grid gap-3 print:break-inside-avoid">
              <h2 id="prop-map" className="text-lg font-semibold">
                {t('realestate.public.location')}
              </h2>
              {coords && (
                <iframe
                  title={t('realestate.public.mapTitle', { name: product.name })}
                  src={osmEmbedUrl(coords)}
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                  className="h-72 w-full rounded-xl border border-slate-200 print:hidden"
                />
              )}
              <div className="flex flex-wrap gap-2 print:hidden">
                <a href={googleMapsUrl(coords ?? address)} target="_blank" rel="noopener noreferrer" className={linkBtn}>
                  <MapPin className="size-4" aria-hidden />
                  {t('realestate.public.openGoogle')}
                  <ExternalLink className="size-3.5 opacity-70" aria-hidden />
                </a>
                {coords && (
                  <a href={osmLink(coords)} target="_blank" rel="noopener noreferrer" className={linkBtn}>
                    {t('realestate.public.openOsm')}
                    <ExternalLink className="size-3.5 opacity-70" aria-hidden />
                  </a>
                )}
              </div>
              {coords && (
                <p className="hidden text-sm text-slate-700 print:block">
                  {coords.lat}, {coords.lng}
                </p>
              )}
            </section>
          )}
        </div>

        <aside className="grid content-start gap-3 lg:sticky lg:top-6 print:mt-6 print:block">
          <div className="hidden gap-3 rounded-2xl border border-slate-200 p-5 shadow-sm lg:grid print:grid print:shadow-none">
            <p className="text-sm text-slate-600">{t('realestate.public.interested')}</p>
            <p className="text-2xl font-bold text-emerald-800">{priceText(listing, t)}</p>
            <div className="grid gap-2 print:hidden">
              {waHref && (
                <a href={waHref} target="_blank" rel="noopener noreferrer" className={waBtn}>
                  <MessageCircle className="size-5" aria-hidden />
                  {t('realestate.public.whatsapp')}
                </a>
              )}
              <VisitButton
                label={t('realestate.public.visit')}
                message={t('realestate.public.visitMessage', { name: product.name, url })}
                webchatKey={listing.webchatKey}
                lang={locale}
                whatsappHref={visitWaHref}
                className={visitBtn}
              />
            </div>
            <p className="hidden text-sm text-slate-700 print:block">
              {workspace.name}
              {listing.whatsapp ? ` · +${listing.whatsapp}` : ''}
              <br />
              {url}
            </p>
          </div>
          <PrintButton
            label={t('realestate.public.print')}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium text-slate-700 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-emerald-500 print:hidden"
          />
        </aside>
      </main>

      {/* On phones the sticky CTA bar replaces the chat launcher; "Agendar visita" reveals the widget. */}
      {listing.webchatKey && (
        <style>{`@media (max-width:1023px){[data-whasalia-webchat]:not([data-cnx-open]){display:none!important}}@media print{[data-whasalia-webchat]{display:none!important}}`}</style>
      )}
      {hasCta && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 px-4 py-3 shadow-[0_-4px_16px_rgba(0,0,0,0.08)] backdrop-blur lg:hidden print:hidden">
          <div className="mx-auto grid max-w-5xl grid-cols-2 gap-2">
            {waHref && (
              <a href={waHref} target="_blank" rel="noopener noreferrer" className={`${waBtn} px-3 text-sm ${listing.webchatKey || visitWaHref ? '' : 'col-span-2'}`}>
                <MessageCircle className="size-5" aria-hidden />
                {t('realestate.public.whatsappShort')}
              </a>
            )}
            <VisitButton
              label={t('realestate.public.visit')}
              message={t('realestate.public.visitMessage', { name: product.name, url })}
              webchatKey={listing.webchatKey}
              lang={locale}
              whatsappHref={visitWaHref}
              className={`${visitBtn} px-3 text-sm ${waHref ? '' : 'col-span-2'}`}
            />
          </div>
        </div>
      )}

      <footer className="border-t border-slate-200 py-6 text-center text-xs text-slate-600 print:hidden">
        {workspace.name}
      </footer>
    </div>
  );
}

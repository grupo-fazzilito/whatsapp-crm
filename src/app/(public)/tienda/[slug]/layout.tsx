import Link from 'next/link';
import { notFound } from 'next/navigation';
import { MessageCircle } from 'lucide-react';
import { moneyLocale } from '@/lib/workspace/countries';
import { loadStore } from '@/lib/store/server';
import { storeTexts } from '@/lib/store/texts';
import { CartButton, StoreProvider } from './cart';

type Props = { children: React.ReactNode; params: Promise<{ slug: string }> };

/** Public store shell: header with the cart, preview notice and footer. Always light. */
export default async function StoreLayout({ children, params }: Props) {
  const { slug } = await params;
  const s = await loadStore(slug);
  if (!s) notFound();
  const ws = s.workspace;
  const t = storeTexts(ws.locale);
  const home = `/tienda/${encodeURIComponent(ws.slug)}`;

  return (
    <div lang={ws.locale} className="min-h-screen bg-slate-50 text-slate-900 [color-scheme:light]">
      <StoreProvider config={{ slug: ws.slug, name: ws.name, currency: ws.currency, moneyLocale: moneyLocale(ws), locale: ws.locale, accent: s.store.accent }}>
        {s.preview && (
          <p role="status" className="bg-amber-100 px-4 py-2 text-center text-xs font-medium text-amber-900">
            {t.preview}
          </p>
        )}
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
          <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4">
            <Link href={home} className="flex min-w-0 items-center gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2" style={{ ['--tw-ring-color' as string]: s.store.accent }}>
              {ws.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element -- business logo from storage
                <img src={ws.logo_url} alt="" className="size-10 shrink-0 rounded-full object-cover ring-1 ring-slate-200" />
              ) : (
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full text-base font-bold text-white" style={{ background: s.store.accent }} aria-hidden>
                  {ws.name.trim().charAt(0).toUpperCase()}
                </span>
              )}
              <span className="truncate text-base font-semibold">{ws.name}</span>
            </Link>
            <div className="ml-auto flex items-center gap-2">
              {s.whatsapp && (
                <a
                  href={`https://wa.me/${s.whatsapp}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={t.writeUs}
                  title={t.writeUs}
                  className="inline-flex size-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-800 hover:bg-slate-50"
                >
                  <MessageCircle className="size-5" aria-hidden />
                </a>
              )}
              <CartButton />
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 pb-16 pt-6">{children}</main>
        <footer className="border-t border-slate-200 bg-white py-6 text-center text-xs text-slate-500">
          <p>© {new Date().getFullYear()} {ws.name}</p>
          <p className="mt-1">
            <Link href="/" className="hover:text-slate-800">{t.poweredBy}</Link>
          </p>
        </footer>
      </StoreProvider>
    </div>
  );
}

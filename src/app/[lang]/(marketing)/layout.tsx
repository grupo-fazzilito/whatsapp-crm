import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { AuroraBackground } from '@/components/marketing/aurora-background';
import { GlassNavbar } from '@/components/marketing/navbar';
import { Footer } from '@/components/marketing/footer';
import { MarketingThemeProvider } from '@/components/marketing/marketing-theme-provider';
import { I18nProvider } from '@/i18n/client';
import { isLocale } from '@/i18n/config';
import { languageAlternates, localizedPath } from '@/i18n/marketing-routes';
import { createTranslator } from '@/i18n/translate';

type Props = { children: ReactNode; params: Promise<{ lang: string }> };

/** `/terms-of-service` → `termsOfService`; home → `home`. */
const metaKey = (path: string) => (path ? path.slice(1).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()) : 'home');

// Title, description, canonical URL and hreflang links of each public page,
// in the language of its URL. The proxy passes the page path (x-marketing-path).
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { lang } = await params;
  if (!isLocale(lang)) return {};
  const path = (await headers()).get('x-marketing-path') ?? '';
  const t = createTranslator(lang);
  const key = metaKey(path);
  const title = t(`mktShell.meta.${key}.title`);
  const description = t(`mktShell.meta.${key}.description`);
  const url = localizedPath(lang, path);
  return {
    title: key === 'home' ? { absolute: title } : title,
    description,
    alternates: { canonical: url, languages: languageAlternates(path) },
    openGraph: { title, description, url, locale: lang === 'es' ? 'es_PE' : 'en_US', alternateLocale: lang === 'es' ? 'en_US' : 'es_PE' },
    twitter: { title, description },
  };
}

export default async function MarketingLayout({ children, params }: Props) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  return (
    <I18nProvider locale={lang}>
      <MarketingThemeProvider>
        <AuroraBackground showRadialGlows={true}>
          <GlassNavbar />
          <main className="flex w-full flex-1 flex-col pt-16">{children}</main>
          <Footer />
        </AuroraBackground>
      </MarketingThemeProvider>
    </I18nProvider>
  );
}

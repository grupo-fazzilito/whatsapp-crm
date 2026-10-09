import React from 'react';
import { AuroraBackground } from '@/components/marketing/aurora-background';
import { GlassNavbar } from '@/components/marketing/navbar';
import { Footer } from '@/components/marketing/footer';
import { MarketingThemeProvider } from '@/components/marketing/marketing-theme-provider';
import { I18nProvider } from '@/i18n/client';
import { getLocale } from '@/i18n/server';

export default async function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <I18nProvider locale={await getLocale()}>
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

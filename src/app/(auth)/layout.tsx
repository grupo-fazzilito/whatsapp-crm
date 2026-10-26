import type { Metadata } from "next";
import type { ReactNode } from "react";

// Shared metadata for auth pages (login / signup / forgot-password).
// None of these should be indexed — they'd compete with the marketing
// landing in SERPs and offer nothing to a searcher who hasn't already
// signed up. Each page still gets its own <title> via its own
// metadata.title override below the route group layout.
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
    },
  },
};

import { MarketingThemeProvider } from "@/components/marketing/marketing-theme-provider";
import { I18nProvider } from "@/i18n/client";
import { AuroraBackground } from "@/components/marketing/aurora-background";
import { GlassNavbar } from "@/components/marketing/navbar";
import { Footer } from "@/components/marketing/footer";
import { getLocale } from "@/i18n/server";

export default async function AuthLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  return (
    <I18nProvider locale={locale}>
      <MarketingThemeProvider>
        {/* Same menu and footer as the public site. */}
        <AuroraBackground showRadialGlows={true}>
          <GlassNavbar />
          <main className="flex w-full flex-1 flex-col pt-16">{children}</main>
          <Footer />
        </AuroraBackground>
      </MarketingThemeProvider>
    </I18nProvider>
  );
}


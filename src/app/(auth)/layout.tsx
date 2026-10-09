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
import { LanguageSwitcher } from "@/components/language-switcher";
import { getLocale } from "@/i18n/server";

export default async function AuthLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  return (
    <I18nProvider locale={locale}>
      <MarketingThemeProvider>
        <div className="fixed right-4 top-4 z-50">
          <LanguageSwitcher variant="marketing" />
        </div>
        {children}
      </MarketingThemeProvider>
    </I18nProvider>
  );
}


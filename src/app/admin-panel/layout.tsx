import type { Metadata } from "next";
import { I18nProvider } from "@/i18n/client";
import { getLocale } from "@/i18n/server";

export const metadata: Metadata = {
  title: "Super Admin — ChatNexGen",
  robots: { index: false, follow: false },
};

export default async function AdminPanelLayout({ children }: { children: React.ReactNode }) {
  return <I18nProvider locale={await getLocale()}>{children}</I18nProvider>;
}

import type { Metadata } from "next";
import { DashboardShell } from "./dashboard-shell";
import { I18nProvider } from "@/i18n/client";
import { getLocale } from "@/i18n/server";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { getWorkspaceContext } from "@/lib/workspace/context";
import { isPlatformAdmin } from "@/lib/admin/guard";

// Server layout whose only job is to declare "do not index" metadata
// for the authed app. robots.ts already disallows these paths at the
// crawler-level and the proxy redirects unauthenticated visitors, so
// this is belt-and-suspenders — but SEO-critical if a URL ever leaks
// via a link shared externally.
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

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // The platform super-admin works from /admin-panel, never inside a business's CRM.
  if (await isPlatformAdmin()) redirect("/admin-panel");
  // Signed in without a business yet (Google / Facebook sign-up): set it up first.
  if (!(await getWorkspaceContext()) && (await getSessionUser())) redirect("/welcome");
  const locale = await getLocale();
  return (
    <I18nProvider locale={locale}>
      <DashboardShell>{children}</DashboardShell>
    </I18nProvider>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { WorkspaceProvider, useWorkspace } from "@/hooks/use-workspace";
import { useT } from "@/i18n/client";
import { SectionTabs } from "@/components/layout/section-tabs";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { CreditsBanner } from "@/components/billing/credits-banner";
import { TourProvider } from "@/components/tour/guided-tour";
import { SetupHelpOffer } from "@/components/support/setup-help-dialog";
import { CallCenter } from "@/components/calls/call-center";
import { ImpersonationBar } from "@/components/admin/impersonation-bar";

// Auth-gated dashboard shell. Extracted from the layout so the layout
// itself can stay a server component and export metadata (noindex) —
// client components can't export Next's metadata object.

function DashboardShellInner({ children }: { children: React.ReactNode }) {
  const { user, loading, profile } = useAuth();
  const { workspace, loading: wsLoading, missing } = useWorkspace();
  const t = useT();
  const router = useRouter();

  // Sidebar drawer state — only used on mobile. On lg+ the sidebar is
  // always visible and this stays at `false` (ignored by the component).
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [user, loading, router]);

  // The platform super-admin never works inside a business's CRM (the
  // server layout already sends it to /admin-panel; this covers a profile
  // flagged while the page was open).
  const sendToAdminPanel = !!profile?.is_platform_admin;
  useEffect(() => {
    if (sendToAdminPanel) router.replace("/admin-panel");
  }, [sendToAdminPanel, router]);

  if (loading || (user && wsLoading) || sendToAdminPanel) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-foreground animate-fade-in">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        </div>
      </div>
    );
  }

  if (!user) return null;

  if (missing || !workspace) {
    return (
      <div className="flex h-screen items-center justify-center bg-background p-6 text-center text-foreground">
        <p className="max-w-sm text-sm text-muted-foreground">{t("workspace.noWorkspace")}</p>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <ImpersonationBar />
      <div className="flex min-h-0 flex-1 overflow-hidden">
      <Sidebar open={sidebarOpen} onClose={closeSidebar} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header onOpenSidebar={() => setSidebarOpen(true)} />
        <CreditsBanner />
        <SetupHelpOffer />
        {/* Thinner horizontal padding on mobile so cards have room to breathe. */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="mx-auto w-full max-w-screen-xl">
            <SectionTabs />
            {children}
          </div>
        </main>
      </div>
      </div>
      <CallCenter />
    </div>
  );
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <WorkspaceProvider>
        <TourProvider>
          <DashboardShellInner>{children}</DashboardShellInner>
        </TourProvider>
      </WorkspaceProvider>
    </AuthProvider>
  );
}

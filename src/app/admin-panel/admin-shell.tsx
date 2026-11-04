"use client";

import { useState, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import {
  Shield, Users, BarChart2, Settings, LogOut,
  Menu, X, ChevronRight, Building2, Coins, LifeBuoy, Webhook, BookOpen, KeyRound, UserRound,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/client";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AdminNotificationBell } from "./notification-bell";

const NAV = [
  { href: "/admin-panel",          label: "Overview",  icon: BarChart2  },
  { href: "/admin-panel/clients",  label: "Clients",   icon: Users      },
  { href: "/admin-panel/billing",  label: "Tokens",    icon: Coins      },
  { href: "/admin-panel/support",  label: "Support",   icon: LifeBuoy   },
  { href: "/admin-panel/complaints", label: "Complaints", icon: BookOpen },
  { href: "/admin-panel/webhooks", label: "Webhooks",  icon: Webhook    },
  { href: "/admin-panel/settings", label: "Settings",  icon: Settings   },
];

async function logout() {
  await fetch("/api/admin/login", { method: "DELETE" }).catch(() => null);
  window.location.href = "/admin-panel/login";
}

/** Avatar menu: the admin's profile, the access log and sign out. */
function UserMenu() {
  const { t } = useI18n();
  const [me, setMe] = useState<{ name: string; email: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetch("/api/admin/profile", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => !cancelled && d && setMe(d))
        .catch(() => {});
    void load();
    window.addEventListener("admin-profile-updated", load);
    return () => {
      cancelled = true;
      window.removeEventListener("admin-profile-updated", load);
    };
  }, []);

  const initial = (me?.name || me?.email || "A").trim().charAt(0).toUpperCase();
  const item = "gap-2.5 px-2 py-1.5 text-slate-200 focus:bg-slate-800 focus:text-white";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t("admin.menu.label")}
        title={t("admin.menu.label")}
        className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 text-xs font-bold hover:bg-emerald-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 transition-colors"
      >
        {initial}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className="min-w-60 border border-slate-800 bg-slate-900 text-slate-200">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="px-2 py-1.5">
            <span className="block truncate text-sm font-semibold text-white">{me?.name || t("admin.menu.admin")}</span>
            {me?.email && <span className="block truncate text-xs font-normal text-slate-400">{me.email}</span>}
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator className="bg-slate-800" />
        <DropdownMenuItem className={item} render={<Link href="/admin-panel/profile" />}>
          <UserRound className="size-4" aria-hidden /> {t("admin.menu.profile")}
        </DropdownMenuItem>
        <DropdownMenuItem className={item} render={<Link href="/admin-panel/access" />}>
          <KeyRound className="size-4" aria-hidden /> {t("admin.menu.accessLog")}
        </DropdownMenuItem>
        <DropdownMenuSeparator className="bg-slate-800" />
        <DropdownMenuItem className={cn(item, "text-red-400 focus:text-red-300")} onClick={() => void logout()}>
          <LogOut className="size-4" aria-hidden /> {t("admin.menu.logout")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname();

  return (
    <>
      {/* Mobile backdrop */}
      <button
        aria-label="Close menu"
        onClick={onClose}
        className={cn(
          "fixed inset-0 z-30 bg-black/50 backdrop-blur-sm lg:hidden transition-opacity",
          open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        )}
      />
      <aside className={cn(
        "fixed inset-y-0 left-0 z-40 flex h-full w-60 flex-col bg-slate-950 border-r border-slate-800 transition-transform duration-200",
        open ? "translate-x-0" : "-translate-x-full",
        "lg:static lg:translate-x-0 lg:z-0"
      )}>
        {/* Logo */}
        <div className="flex h-14 items-center justify-between gap-2 border-b border-slate-800 px-4">
          <Link href="/admin-panel" className="flex items-center gap-2.5">
            <img
              src="/images/logo/whasalia-logo.png"
              alt="Whasalia Logo"
              className="h-10 w-auto object-contain"
            />
          </Link>
          <button onClick={onClose} className="lg:hidden text-slate-500 hover:text-white transition-colors">
            <X className="size-4" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          {NAV.map(item => {
            const isActive = pathname === item.href || (item.href !== "/admin-panel" && pathname.startsWith(item.href));
            return (
              <Link key={item.href} href={item.href} onClick={onClose}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-emerald-500/10 text-emerald-400"
                    : "text-slate-400 hover:bg-slate-800 hover:text-white"
                )}
              >
                <item.icon className="size-4 shrink-0" />
                {item.label}
                {isActive && <ChevronRight className="size-3 ml-auto" />}
              </Link>
            );
          })}
        </nav>

      </aside>
    </>
  );
}

export function AdminShell({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  // Redirect login page away from shell
  if (pathname === "/admin-panel/login") return <>{children}</>;

  return (
    <div className="flex h-screen overflow-hidden bg-slate-950 text-white">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top header */}
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-slate-800 bg-slate-950 px-4 lg:px-6">
          <div className="flex items-center gap-3">
            <button onClick={() => setSidebarOpen(true)}
              className="lg:hidden w-9 h-9 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white transition-colors">
              <Menu className="size-5" />
            </button>
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <Building2 className="size-3.5" />
              <span>Agency</span>
              <ChevronRight className="size-3" />
              <span className="text-white font-medium capitalize">
                {pathname.split("/").pop()?.replace("-", " ") || "Overview"}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <AdminNotificationBell />
            <UserMenu />
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="mx-auto w-full max-w-screen-xl">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

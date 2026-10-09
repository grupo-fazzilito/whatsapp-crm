"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { useTheme } from "@/hooks/use-theme";
import { useWorkspace } from "@/hooks/use-workspace";
import { useT } from "@/i18n/client";
import { LogOut, Menu, Settings as SettingsIcon, User, Sun, Moon } from "lucide-react";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { HelpMenu, TourButton } from "@/components/support/help-menu";
import { LanguageSwitcher } from "@/components/language-switcher";
import { AvailabilityMenuItem } from "@/components/notifications/availability-toggle";

type Label = ReturnType<typeof useWorkspace>["label"];
type T = ReturnType<typeof useT>;

// Longest matching prefix wins. Business pages use the industry's nouns.
function getPageTitle(pathname: string, t: T, label: Label): string {
  const titles: [string, string][] = [
    ["/dashboard", t("nav.dashboard")],
    ["/inbox", t("nav.inbox")],
    ["/contacts", t("nav.contacts")],
    ["/pipelines", t("nav.pipelines")],
    ["/tasks", t("crm.tasks.navTitle")],
    ["/broadcasts", t("nav.broadcasts")],
    ["/automations", t("nav.automations")],
    ["/flows", t("nav.flows")],
    ["/reports", t("reports.navTitle")],
    ["/support", t("support.page.title")],
    ["/settings", t("nav.settings")],
    ["/channels", t("channels.navTitle")],
    ["/agents", t("agents.navTitle")],
    ["/business/dashboard", t("nav.business")],
    ["/business/bookings", label("bookingPlural")],
    ["/business/setup", t("nav.setup")],
    ["/business/staff", label("staffPlural")],
    ["/business/services", label("servicePlural")],
    ["/business/faqs", t("nav.faqs")],
    ["/business/logs", t("nav.aiLogs")],
    ["/catalog", label("productPlural")],
    ["/orders", t("orders.navTitle")],
    ["/captures", t("realestate.captures.navTitle")],
    ["/real-estate/portals", t("portals.navTitle")],
  ];
  const match = titles
    .filter(([path]) => pathname === path || pathname.startsWith(`${path}/`))
    .sort((a, b) => b[0].length - a[0].length)[0];
  return match ? match[1] : t("nav.dashboard");
}

interface HeaderProps {
  /** Wired to the shell's drawer state. Used only on mobile — the
   *  hamburger button is hidden on lg+. */
  onOpenSidebar?: () => void;
}

export function Header({ onOpenSidebar }: HeaderProps) {
  const pathname = usePathname();
  const { profile, signOut } = useAuth();
  const { mode, setMode } = useTheme();
  const t = useT();
  const { label } = useWorkspace();
  const title = getPageTitle(pathname, t, label);

  const initial =
    profile?.full_name?.charAt(0)?.toUpperCase() ??
    profile?.email?.charAt(0)?.toUpperCase() ??
    "U";

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-background px-4 lg:px-6 transition-colors">
      <div className="flex min-w-0 items-center gap-2">
        {/* Hamburger — mobile only. 44×44 hit target per Apple HIG. */}
        <button
          type="button"
          onClick={onOpenSidebar}
          aria-label="Open menu"
          className="flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground lg:hidden"
        >
          <Menu className="h-5 w-5" />
        </button>
        <h1 className="truncate text-base font-semibold text-foreground sm:text-lg">
          {title}
        </h1>
      </div>

      <div className="flex items-center gap-2 sm:gap-3">
        <TourButton />
        <HelpMenu />
        <NotificationBell />
        <LanguageSwitcher className="hidden sm:flex" />
        {/* Sun / Moon Toggle */}
        <button
          type="button"
          onClick={() => setMode(mode === "light" ? "dark" : "light")}
          aria-label={`Switch to ${mode === "light" ? "dark" : "light"} mode`}
          className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition-all hover:bg-accent hover:text-foreground"
        >
          {mode === "light" ? (
            <Moon className="h-4.5 w-4.5 transition-transform duration-300 hover:rotate-12" />
          ) : (
            <Sun className="h-4.5 w-4.5 transition-transform duration-300 hover:rotate-45" />
          )}
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger
            className="flex items-center gap-2 rounded-md px-1 py-1 transition-colors hover:bg-accent focus:bg-accent focus:outline-none data-[state=open]:bg-accent sm:gap-3 sm:pl-1 sm:pr-3"
            aria-label="Open account menu"
          >
            <Avatar className="size-8">
              {profile?.avatar_url ? (
                <AvatarImage
                  src={profile.avatar_url}
                  alt={profile.full_name ?? "Avatar"}
                />
              ) : null}
              <AvatarFallback className="bg-primary/10 text-sm font-medium text-primary">
                {initial}
              </AvatarFallback>
            </Avatar>
            <span className="hidden text-sm font-medium text-foreground sm:inline">
              {profile?.full_name ?? "User"}
            </span>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            sideOffset={6}
            className="min-w-56 bg-popover text-popover-foreground border border-border"
          >
            <div className="px-2 py-1.5">
              <p className="truncate text-sm font-medium text-foreground">
                {profile?.full_name ?? "User"}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {profile?.email ?? ""}
              </p>
            </div>
            <DropdownMenuSeparator className="bg-border" />
            <AvailabilityMenuItem />
            <DropdownMenuSeparator className="bg-border" />
            <DropdownMenuItem
              render={
                <Link
                  href="/settings?tab=profile"
                  className="text-foreground focus:bg-accent focus:text-foreground"
                />
              }
            >
              <User className="size-4" />
              Profile
            </DropdownMenuItem>
            <DropdownMenuItem
              render={
                <Link
                  href="/settings?tab=whatsapp"
                  className="text-foreground focus:bg-accent focus:text-foreground"
                />
              }
            >
              <SettingsIcon className="size-4" />
              Settings
            </DropdownMenuItem>
            <DropdownMenuSeparator className="bg-border" />
            <DropdownMenuItem
              onClick={signOut}
              className="text-foreground focus:bg-accent focus:text-foreground"
            >
              <LogOut className="size-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}


"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useInboxCounts } from "@/hooks/use-total-unread";
import { useTheme } from "@/hooks/use-theme";
import { useWorkspace } from "@/hooks/use-workspace";
import { useT } from "@/i18n/client";
import { WorkspaceSwitcher } from "./workspace-switcher";
import { isActiveEntry, sectionGroups } from "./nav-groups";
import { usePendingOrders } from "@/components/orders/use-pending-orders";
import {
  LayoutDashboard,
  MessageSquare,
  Users,
  GitBranch,
  Zap,
  Settings,
  LogOut,
  User,
  X,
  UserRound,
  BriefcaseBusiness,
  Calendar,
  Radio,
  Bot,
  Package,
  ShoppingBag,
  ListTodo,
  BarChart3,
  HousePlus,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Hand,
} from "lucide-react";
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

interface NavItem {
  href: string;
  /** i18n key, or a ready label for industry nouns. */
  label: string;
  icon: typeof LayoutDashboard;
  /**
   * When true, the nav row renders a small "Beta" chip after the label.
   * Purely informational — doesn't affect routing or access.
   */
  beta?: boolean;
  /** Small count chip (e.g. new orders). Hidden when 0. */
  badge?: number;
}

// Main entries: the day-to-day CRM.
const navItems: NavItem[] = [
  { href: "/dashboard", label: "nav.dashboard", icon: LayoutDashboard },
  { href: "/inbox", label: "nav.inbox", icon: MessageSquare },
  { href: "/contacts", label: "nav.contacts", icon: Users },
  { href: "/pipelines", label: "nav.pipelines", icon: GitBranch },
  { href: "/tasks", label: "crm.tasks.navTitle", icon: ListTodo },
];

// Tools: set up once, visited less often (collapsible section). Related
// pages (Flows, FAQs, AI logs) are tabs inside these entries.
const toolNavItems: NavItem[] = [
  { href: "/agents", label: "agents.navTitle", icon: Bot },
  { href: "/automations", label: "nav.automations", icon: Zap },
  { href: "/channels", label: "channels.navTitle", icon: Radio },
  { href: "/reports", label: "reports.navTitle", icon: BarChart3 },
];

const TOOLS_OPEN_KEY = "nav:tools-open";
const COLLAPSED_KEY = "whasalia.sidebar.collapsed";

const bottomNavItems = [
  { href: "/settings", label: "nav.settings", icon: Settings },
];

interface SidebarProps {
  /** Controlled on mobile by the Header's hamburger button. Ignored on lg+. */
  open?: boolean;
  onClose?: () => void;
}

export function Sidebar({ open = false, onClose }: SidebarProps) {
  const pathname = usePathname();
  const { profile, signOut } = useAuth();
  const { modules, label, can, workspace } = useWorkspace();
  const t = useT();
  const pendingOrders = usePendingOrders();

  // Business section: only the modules this workspace's industry uses,
  // named with the industry's own nouns (Doctors, Barbers, Teachers...).
  // Services sit inside the catalog when the industry has both.
  const businessNavItems: NavItem[] = [
    ...(modules.bookings ? [{ href: "/business/bookings", label: label("bookingPlural"), icon: Calendar }] : []),
    ...(modules.products
      ? [{ href: "/catalog", label: label("productPlural"), icon: Package }]
      : modules.services
        ? [{ href: "/business/services", label: label("servicePlural"), icon: BriefcaseBusiness }]
        : []),
    ...(modules.orders ? [{ href: "/orders", label: t("orders.navTitle"), icon: ShoppingBag, badge: pendingOrders }] : []),
    ...(modules.staff ? [{ href: "/business/staff", label: label("staffPlural"), icon: UserRound }] : []),
    ...(workspace?.industry === "real_estate" ? [{ href: "/captures", label: t("realestate.captures.navTitle"), icon: HousePlus }] : []),
  ];
  const groups = sectionGroups({ t, label, modules, isAdmin: can("admin"), industry: workspace?.industry });
  const isActive = (href: string) => isActiveEntry(groups, href, pathname);
  const toolActive = toolNavItems.some((i) => isActive(i.href));
  const [toolsOpen, setToolsOpen] = useState(true);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(TOOLS_OPEN_KEY);
      if (saved !== null) setToolsOpen(saved === "1");
    } catch {}
  }, []);
  const toggleTools = () => {
    const next = !toolsOpen;
    setToolsOpen(next);
    try {
      localStorage.setItem(TOOLS_OPEN_KEY, next ? "1" : "0");
    } catch {}
  };
  // Desktop: the menu can shrink to icons only (remembered per browser).
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem(COLLAPSED_KEY) === "1") setCollapsed(true);
    } catch {}
  }, []);
  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
    } catch {}
  };
  const { unread: totalUnread, attention: needsAttention } = useInboxCounts();
  const { mode } = useTheme();
  const isLight = mode === "light";

  // Close the drawer when route changes — users opened it to navigate,
  // so once they pick a destination the drawer should get out of the way.
  useEffect(() => {
    onClose?.();
    // Only pathname drives this — onClose identity doesn't need to re-run it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Lock body scroll and allow Escape to close while the drawer is open on
  // mobile. No-ops on desktop because the sidebar isn't positioned there.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  return (
    <>
      {/* Backdrop — only exists on mobile and only when open. Clicking
          it closes the drawer. Hidden from lg+ since the sidebar is
          part of the main flex row there. */}
      <button
        type="button"
        aria-label="Close menu"
        onClick={onClose}
        className={cn(
          "fixed inset-0 z-30 bg-slate-950/40 backdrop-blur-xs transition-opacity lg:hidden",
          open
            ? "pointer-events-auto opacity-100"
            : "pointer-events-none opacity-0",
        )}
      />

      <aside
        className={cn(
          // Mobile: fixed drawer that slides in from the left.
          "fixed inset-y-0 left-0 z-40 flex h-full w-64 flex-col border-r border-sidebar-border bg-sidebar transition-colors",
          "transition-transform duration-200 ease-out will-change-transform",
          open ? "translate-x-0" : "-translate-x-full",
          // Desktop: static, always visible — reset all the mobile framing.
          "lg:static lg:z-0 lg:translate-x-0 lg:transition-[width] lg:duration-200",
          collapsed ? "lg:w-16" : "lg:w-60",
        )}
        aria-label="Primary"
      >
        {/* Logo row. On mobile we put a close button here; on desktop the
            close button is hidden since the sidebar is always-visible. */}
        <div
          className={cn(
            "relative flex h-14 shrink-0 items-center justify-between gap-2 border-b border-sidebar-border px-4",
            collapsed && "lg:justify-center lg:px-2",
          )}
        >
          <Link href="/dashboard" className="flex items-center gap-2" aria-label="Whasalia">
            <img
              src={isLight ? "/images/logo/whasalia-logo-light.png" : "/images/logo/whasalia-logo.png"}
              alt="Whasalia Logo"
              className={cn("h-8 w-auto object-contain", collapsed && "lg:hidden")}
            />
            {/* Collapsed menu: just the Whasalia icon. */}
            <img src="/images/logo/favicon.png" alt="" aria-hidden="true" className={cn("hidden h-8 w-8 rounded-lg", collapsed && "lg:block")} />
          </Link>
          {/* Desktop: collapse / expand, on the edge next to the logo. */}
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={collapsed ? t("nav.expandMenu") : t("nav.collapseMenu")}
            title={collapsed ? t("nav.expandMenu") : t("nav.collapseMenu")}
            aria-expanded={!collapsed}
            className="absolute -right-3 top-1/2 z-10 hidden h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full border border-sidebar-border bg-sidebar text-sidebar-foreground/70 shadow-sm hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:flex"
          >
            {collapsed ? <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" /> : <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="flex h-9 w-9 items-center justify-center rounded-md text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground lg:hidden"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Main navigation */}
        <nav className={cn("flex-1 overflow-y-auto px-3 py-4", collapsed && "lg:px-2")}>
          <div className={cn("mb-4", collapsed && "lg:hidden")} data-tour="workspace-switcher">
            <WorkspaceSwitcher />
          </div>
          <ul className="flex flex-col gap-1">
            {navItems.map((item) => {
              const active = isActive(item.href);
              const showUnreadDot =
                item.href === "/inbox" && totalUnread > 0 && !active;

              return (
                <li key={item.href}>
                  <Link
                    data-tour={`nav:${item.href}`}
                    href={item.href}
                    title={collapsed ? t(item.label) : undefined}
                    className={cn(
                      // Taller on mobile so fingers can hit the row reliably (≥44px).
                      "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors lg:py-2",
                      collapsed && "lg:justify-center lg:px-0",
                      active
                        ? "bg-primary/10 text-primary"
                        : "text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                    )}
                  >
                    <item.icon className="h-4 w-4" />
                    <span className={cn("flex-1", collapsed && "lg:sr-only")}>{t(item.label)}</span>
                    {item.beta && (
                      <span
                        aria-label="Beta feature"
                        className={cn("rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-300", collapsed && "lg:hidden")}
                      >
                        Beta
                      </span>
                    )}
                    {showUnreadDot && (
                      <span
                        aria-label={`${totalUnread} unread conversation${totalUnread === 1 ? "" : "s"}`}
                        className="relative flex h-2 w-2"
                      >
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
                      </span>
                    )}
                  </Link>
                  {item.href === "/inbox" && needsAttention > 0 && (
                    <Link
                      href="/inbox?view=attention"
                      title={collapsed ? `${t("inboxpro.attention.nav")} (${needsAttention})` : undefined}
                      className={cn(
                        "ml-7 mt-0.5 flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-amber-600 hover:bg-amber-500/10 dark:text-amber-400",
                        collapsed && "lg:ml-0 lg:justify-center lg:gap-0.5 lg:px-0",
                      )}
                    >
                      <Hand className="h-3.5 w-3.5" aria-hidden="true" />
                      <span className={cn("flex-1", collapsed && "lg:sr-only")}>{t("inboxpro.attention.nav")}</span>
                      <span className="rounded-full bg-amber-500 px-1.5 text-[10px] font-semibold text-slate-950">
                        {needsAttention > 99 ? "99+" : needsAttention}
                      </span>
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>

          {businessNavItems.length > 0 && (
            <>
              <div className="my-4 border-t border-sidebar-border" />
              <div className={cn("px-3 mb-2 text-xs font-semibold text-sidebar-foreground/50 uppercase tracking-wider", collapsed && "lg:hidden")} data-tour="nav:business">
                {t("nav.business")}
              </div>
              <ul className="flex flex-col gap-1">
                {businessNavItems.map((item) => (
                  <li key={item.href}>
                    <Link
                      data-tour={`nav:${item.href}`}
                      href={item.href}
                      title={collapsed ? item.label : undefined}
                      className={cn(
                        "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors lg:py-2",
                      collapsed && "lg:justify-center lg:px-0",
                        isActive(item.href)
                          ? "bg-primary/10 text-primary"
                          : "text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                      )}
                    >
                      <item.icon className="h-4 w-4" />
                      <span className={cn("flex-1", collapsed && "lg:sr-only")}>{item.label}</span>
                      {!!item.badge && (
                        <span
                          aria-label={t("orders.navBadge", { count: item.badge })}
                          className={cn("min-w-5 rounded-full bg-primary px-1.5 py-0.5 text-center text-[10px] font-semibold leading-none text-primary-foreground", collapsed && "lg:hidden")}
                        >
                          {item.badge > 99 ? "99+" : item.badge}
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}

          <div className="my-4 border-t border-sidebar-border" />
          <button
            type="button"
            onClick={toggleTools}
            aria-expanded={toolsOpen || toolActive}
            aria-controls="nav-tools"
            className={cn("mb-2 flex w-full items-center justify-between rounded px-3 text-xs font-semibold uppercase tracking-wider text-sidebar-foreground/50 hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", collapsed && "lg:hidden")}
          >
            {t("nav.tools")}
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", !(toolsOpen || toolActive) && "-rotate-90")} aria-hidden />
          </button>
          {(toolsOpen || toolActive || collapsed) && (
            <ul id="nav-tools" className={cn("flex flex-col gap-1", !(toolsOpen || toolActive) && "hidden lg:flex")}>
              {toolNavItems.map((item) => (
                <li key={item.href}>
                  <Link
                    data-tour={`nav:${item.href}`}
                    href={item.href}
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors lg:py-2",
                      collapsed && "lg:justify-center lg:px-0",
                      isActive(item.href)
                        ? "bg-primary/10 text-primary"
                        : "text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                    )}
                  >
                    <item.icon className="h-4 w-4" />
                    <span className={cn("flex-1", collapsed && "lg:sr-only")}>{t(item.href === "/reports" && !can("admin") ? "reports.navPersonal" : item.label)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}


          <div className="my-4 border-t border-sidebar-border" />

          <ul className="flex flex-col gap-1">
            {bottomNavItems.map((item) => {
              const active = isActive(item.href);
              return (
                <li key={item.href}>
                  <Link
                    data-tour={`nav:${item.href}`}
                    href={item.href}
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors lg:py-2",
                      collapsed && "lg:justify-center lg:px-0",
                      active
                        ? "bg-primary/10 text-primary"
                        : "text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                    )}
                  >
                    <item.icon className="h-4 w-4" />
                    <span className={cn(collapsed && "lg:sr-only")}>{t(item.label)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* User section */}
        <div className="shrink-0 border-t border-sidebar-border p-3">
          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn(
                "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus:bg-sidebar-accent focus:outline-none data-[state=open]:bg-sidebar-accent",
                collapsed && "lg:justify-center lg:px-0",
              )}
            >
              <Avatar className="size-8 shrink-0">
                {profile?.avatar_url ? (
                  <AvatarImage
                    src={profile.avatar_url}
                    alt={profile.full_name ?? "Avatar"}
                  />
                ) : null}
                <AvatarFallback className="bg-primary/10 text-sm font-medium text-primary">
                  {profile?.full_name?.charAt(0)?.toUpperCase() ??
                    profile?.email?.charAt(0)?.toUpperCase() ??
                    "U"}
                </AvatarFallback>
              </Avatar>
              <div className={cn("min-w-0 flex-1", collapsed && "lg:hidden")}>
                <p className="truncate text-sm font-medium text-sidebar-foreground">
                  {profile?.full_name ?? "User"}
                </p>
                <p className="truncate text-xs text-sidebar-foreground/60">
                  {profile?.email ?? ""}
                </p>
              </div>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              side="top"
              sideOffset={6}
              className="min-w-56 bg-popover text-popover-foreground border border-border"
            >
              <DropdownMenuItem
                render={
                  <Link
                    href="/settings?tab=profile"
                    onClick={onClose}
                    className="text-foreground focus:bg-accent focus:text-foreground"
                  />
                }
              >
                <User className="size-4" />
                {t("nav.profile")}
              </DropdownMenuItem>
              <DropdownMenuItem
                render={
                  <Link
                    href="/settings?tab=team"
                    onClick={onClose}
                    className="text-foreground focus:bg-accent focus:text-foreground"
                  />
                }
              >
                <Settings className="size-4" />
                {t("nav.settings")}
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-border" />
              <DropdownMenuItem
                onClick={signOut}
                className="text-foreground focus:bg-accent focus:text-foreground"
              >
                <LogOut className="size-4" />
                {t("nav.signOut")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>
    </>
  );
}

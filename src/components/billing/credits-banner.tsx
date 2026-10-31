"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { AlertTriangle, Coins } from "lucide-react";
import { useWorkspace } from "@/hooks/use-workspace";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/utils";
import { TopUpDialog } from "./top-up-dialog";

interface Status {
  balance: number;
  enforce: boolean;
  low: boolean;
  depleted: boolean;
}

/** Top-of-app notice for admins when AI credits are low or gone, with the purchase right there. */
export function CreditsBanner() {
  const { workspace, can } = useWorkspace();
  const { t, locale } = useI18n();
  const pathname = usePathname();
  const [status, setStatus] = useState<Status | null>(null);
  const [buying, setBuying] = useState(false);
  const [reload, setReload] = useState(0);
  const isAdmin = can("admin");
  const wsId = workspace?.id;

  useEffect(() => {
    if (!isAdmin || !wsId) return;
    let alive = true;
    const load = () =>
      fetch("/api/billing/status", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d: Status | null) => alive && setStatus(d))
        .catch(() => {});
    void load();
    const timer = setInterval(load, 5 * 60_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [isAdmin, wsId, pathname, reload]);

  if (!isAdmin || !status?.enforce || (!status.low && !status.depleted)) return null;
  if (pathname === "/settings" && typeof window !== "undefined" && window.location.search.includes("tab=billing")) return null;

  return (
    <div
      role="status"
      className={cn(
        "flex flex-wrap items-center justify-center gap-x-3 gap-y-1 px-4 py-2 text-sm",
        status.depleted
          ? "bg-red-600 text-white"
          : "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200",
      )}
    >
      <AlertTriangle className="size-4 shrink-0" aria-hidden />
      <span>
        {status.depleted
          ? t("billing.banner.depleted")
          : t("billing.banner.low", { n: new Intl.NumberFormat(locale === "en" ? "en-US" : "es-PE").format(status.balance) })}
      </span>
      <button
        type="button"
        onClick={() => setBuying(true)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-semibold shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current",
          status.depleted ? "bg-white text-red-700 hover:bg-red-50" : "bg-amber-600 text-white hover:bg-amber-700 dark:bg-amber-500 dark:text-slate-950 dark:hover:bg-amber-400",
        )}
      >
        <Coins className="size-3.5" aria-hidden />
        {t("billing.banner.action")}
      </button>
      <TopUpDialog open={buying} onOpenChange={setBuying} onPaid={() => setReload((n) => n + 1)} />
    </div>
  );
}

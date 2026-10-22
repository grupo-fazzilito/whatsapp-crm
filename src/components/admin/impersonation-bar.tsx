"use client";

import { useState } from "react";
import { ShieldAlert } from "lucide-react";
import { useT } from "@/i18n/client";
import { stopImpersonating, useAuth } from "@/hooks/use-auth";

/** Shown only to a platform admin viewing a customer's account. */
export function ImpersonationBar() {
  const t = useT();
  const { impersonating, profile, user } = useAuth();
  const [busy, setBusy] = useState(false);
  if (!impersonating) return null;
  const who = profile?.full_name || user?.email || "";
  return (
    <div role="status" className="flex shrink-0 flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-amber-500 px-4 py-1.5 text-sm text-slate-950">
      <span className="flex items-center gap-1.5">
        <ShieldAlert className="h-4 w-4" aria-hidden="true" />
        {t("admin.impersonation.viewing", { name: who })}
      </span>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void stopImpersonating();
        }}
        className="rounded-md bg-amber-950 px-2.5 py-0.5 text-xs font-semibold text-amber-100 hover:bg-amber-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-950 disabled:opacity-60"
      >
        {t("admin.impersonation.back")}
      </button>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useWorkspace } from "@/hooks/use-workspace";
import { useI18n } from "@/i18n/client";
import { DropdownMenuCheckboxItem } from "@/components/ui/dropdown-menu";

/**
 * "Disponible" switch for the account menu. Only available members get
 * auto-assigned (round-robin) conversations and team transfers.
 */
export function AvailabilityMenuItem() {
  const { workspace } = useWorkspace();
  const { t } = useI18n();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const workspaceId = workspace?.id;

  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    fetch("/api/teams/availability", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data) setAvailable(data.available !== false);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  const toggle = async (next: boolean) => {
    const before = available;
    setAvailable(next);
    setBusy(true);
    try {
      const res = await fetch("/api/teams/availability", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ available: next }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error);
      setAvailable(data.available !== false);
      toast.success(next ? t("inboxpro.availability.on") : t("inboxpro.availability.off"));
    } catch {
      setAvailable(before);
      toast.error(t("inboxpro.availability.failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <DropdownMenuCheckboxItem
      checked={available === true}
      disabled={available === null || busy}
      closeOnClick={false}
      onCheckedChange={(v) => void toggle(v === true)}
      className="text-foreground focus:bg-accent focus:text-foreground"
    >
      <span
        className={available ? "h-2 w-2 rounded-full bg-emerald-500" : "h-2 w-2 rounded-full border border-muted-foreground"}
        aria-hidden="true"
      />
      {t("inboxpro.availability.label")}
    </DropdownMenuCheckboxItem>
  );
}

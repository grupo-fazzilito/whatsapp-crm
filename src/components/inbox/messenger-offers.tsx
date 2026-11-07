"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { BellPlus, CheckCircle2, Loader2, Megaphone } from "lucide-react";
import { useT } from "@/i18n/client";

interface State {
  messenger: boolean;
  status: "invited" | "subscribed" | "stopped" | null;
  connected: boolean;
}

/** Inbox sidebar (Messenger chats): subscription to the business's offers and "Invite". */
export function MessengerOffers({ conversationId, sectionTitle }: { conversationId: string; sectionTitle: string }) {
  const t = useT();
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/messenger-marketing/invite?conversation=${conversationId}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((s: State | null) => !cancelled && setState(s));
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  if (!state?.messenger) return null;

  const invite = async () => {
    setBusy(true);
    const res = await fetch("/api/messenger-marketing/invite", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversation_id: conversationId }) }).catch(() => null);
    const body = await res?.json().catch(() => ({}));
    setBusy(false);
    if (res?.ok) {
      toast.success(t("mm.inbox.invited"));
      setState({ ...state, status: "invited" });
    } else toast.error(body?.error === "not_connected" ? t("mm.inbox.notConnected") : t("mm.inbox.error", { message: body?.message ?? body?.error ?? "" }));
  };

  return (
    <section aria-labelledby="sidebar-mm-title">
      <h4 id="sidebar-mm-title" className={sectionTitle}>
        <Megaphone className="h-3 w-3" aria-hidden="true" />
        {t("mm.inbox.title")}
      </h4>
      <div className="mt-2 space-y-2 px-2 text-sm">
        {state.status && (
          <p className="flex items-center gap-1.5 text-muted-foreground">
            {state.status === "subscribed" && <CheckCircle2 className="size-4 text-emerald-500" aria-hidden />}
            {t(`mm.inbox.status.${state.status}`)}
          </p>
        )}
        {state.status !== "subscribed" &&
          (state.connected ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void invite()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs font-medium hover:bg-muted disabled:opacity-50"
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <BellPlus className="size-3.5" aria-hidden />} {t("mm.inbox.invite")}
            </button>
          ) : (
            <p className="text-xs text-muted-foreground">{t("mm.inbox.notConnected")}</p>
          ))}
      </div>
    </section>
  );
}

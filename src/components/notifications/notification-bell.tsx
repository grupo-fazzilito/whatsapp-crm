"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { es as esLocale, enUS } from "date-fns/locale";
import { AtSign, ArrowRightLeft, Bell, CheckCheck, UserCheck, Info, Coins } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useWorkspace } from "@/hooks/use-workspace";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/utils";
import type { AppNotification } from "@/lib/inbox/types";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { OPEN_CONVERSATION_EVENT } from "./events";

const TYPE_ICON = {
  mention: AtSign,
  assigned: UserCheck,
  transferred: ArrowRightLeft,
  system: Info,
  billing: Coins,
} as const;

/** Header bell: unread count, live updates, mark read, jump to the conversation. */
export function NotificationBell() {
  const { user } = useAuth();
  const { workspace } = useWorkspace();
  const { t, locale } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [announce, setAnnounce] = useState("");
  const userId = user?.id;
  const workspaceId = workspace?.id;

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications?limit=30", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setItems(data.notifications ?? []);
      setUnread(data.unread ?? 0);
    } catch {
      // offline — the next open retries
    }
  }, []);

  const loadRef = useRef(load);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    loadRef.current = load;
  });

  useEffect(() => {
    if (!userId || !workspaceId) return;
    let cancelled = false;
    fetch("/api/notifications?limit=30", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setItems(data.notifications ?? []);
        setUnread(data.unread ?? 0);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [userId, workspaceId]);

  // Live: new notifications for me (any workspace; only the active one counts).
  useEffect(() => {
    if (!userId || !workspaceId) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        (payload) => {
          const row = payload.new as AppNotification;
          if (row.workspace_id !== workspaceId) return;
          setItems((prev) => (prev.some((n) => n.id === row.id) ? prev : [row, ...prev].slice(0, 50)));
          if (!row.read_at) setUnread((n) => n + 1);
          setAnnounce(row.title);
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        (payload) => {
          const row = payload.new as AppNotification;
          if (row.workspace_id !== workspaceId) return;
          // Marked read in another tab: sync the list and the count.
          setItems((prev) => prev.map((n) => (n.id === row.id ? row : n)));
          if (syncTimer.current) clearTimeout(syncTimer.current);
          syncTimer.current = setTimeout(() => void loadRef.current(), 500);
        },
      )
      .subscribe();
    return () => {
      if (syncTimer.current) clearTimeout(syncTimer.current);
      supabase.removeChannel(channel);
    };
  }, [userId, workspaceId]);

  const markRead = useCallback(async (body: { ids: string[] } | { all: true }) => {
    const now = new Date().toISOString();
    setItems((prev) =>
      prev.map((n) => (!n.read_at && ("all" in body || body.ids.includes(n.id)) ? { ...n, read_at: now } : n)),
    );
    try {
      const res = await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && typeof data?.unread === "number") setUnread(data.unread);
    } catch {
      // keep the optimistic state; the next load corrects it
    }
  }, []);

  const openItem = (n: AppNotification) => {
    if (!n.read_at) void markRead({ ids: [n.id] });
    setOpen(false);
    if (!n.link) return;
    if (pathname === "/inbox" && n.conversation_id) {
      window.dispatchEvent(new CustomEvent(OPEN_CONVERSATION_EVENT, { detail: { conversationId: n.conversation_id } }));
      return;
    }
    router.push(n.link);
  };

  const label = unread > 0 ? `${t("inboxpro.notifications.title")}, ${t("inboxpro.notifications.unread", { n: unread })}` : t("inboxpro.notifications.title");
  const dateLocale = locale === "es" ? esLocale : enUS;

  return (
    <>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) void load();
        }}
      >
        <PopoverTrigger
          aria-label={label}
          title={t("inboxpro.notifications.title")}
          className="relative flex h-9 w-9 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition-all hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Bell className="h-4.5 w-4.5" aria-hidden="true" />
          {unread > 0 && (
            <span
              className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-none text-white"
              aria-hidden="true"
            >
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[min(22rem,calc(100vw-2rem))] gap-0 p-0">
          <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
            <h2 className="text-sm font-semibold text-foreground">{t("inboxpro.notifications.title")}</h2>
            {unread > 0 && (
              <button
                type="button"
                onClick={() => void markRead({ all: true })}
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />
                {t("inboxpro.notifications.markAll")}
              </button>
            )}
          </div>
          {items.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">{t("inboxpro.notifications.empty")}</p>
          ) : (
            <ul className="max-h-[60vh] overflow-y-auto py-1">
              {items.map((n) => {
                const Icon = TYPE_ICON[n.type] ?? Info;
                const isUnread = !n.read_at;
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => openItem(n)}
                      className={cn(
                        "flex w-full items-start gap-2.5 px-3 py-2 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none",
                        isUnread && "bg-primary/5",
                      )}
                    >
                      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={cn("block text-sm text-foreground", isUnread && "font-semibold")}>{n.title}</span>
                        {n.body && <span className="line-clamp-2 block text-xs text-muted-foreground">{n.body}</span>}
                        <span className="mt-0.5 block text-[11px] text-muted-foreground">
                          {formatDistanceToNow(new Date(n.created_at), { addSuffix: true, locale: dateLocale })}
                        </span>
                      </span>
                      {isUnread && (
                        <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-primary">
                          <span className="sr-only">{t("inboxpro.notifications.unreadItem")}</span>
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </PopoverContent>
      </Popover>
      <span className="sr-only" aria-live="polite">
        {announce}
      </span>
    </>
  );
}

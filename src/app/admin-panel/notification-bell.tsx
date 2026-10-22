"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { es as esLocale, enUS } from "date-fns/locale";
import { Bell, BellRing, CheckCheck, Volume2, VolumeX } from "lucide-react";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { notificationLink, notificationVars } from "@/lib/admin/notifications";
import {
  desktopPermission,
  playChime,
  requestDesktopPermission,
  setSoundEnabled,
  showDesktop,
  soundEnabled,
  type DesktopPermission,
} from "@/lib/notifications/alert";

interface Item {
  id: string;
  type: string;
  data: Record<string, unknown>;
  workspace_name: string | null;
  created_at: string;
  read: boolean;
}

const POLL_MS = 20_000;

/** Admin panel bell: platform events (new businesses, tickets, payments…), polled every 20 s. */
export function AdminNotificationBell() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [unread, setUnread] = useState(0);
  const [sound, setSound] = useState(() => (typeof window === "undefined" ? true : soundEnabled()));
  const [desktop, setDesktop] = useState<DesktopPermission>(() => (typeof window === "undefined" ? "unsupported" : desktopPermission()));
  // Newest notification already seen by this tab (alerts only for newer ones).
  const newest = useRef<string | null>(null);

  const text = useCallback(
    (n: Item) => {
      const key = n.type.replace(/\./g, "_");
      const vars = notificationVars(n.type, n.data ?? {}, n.workspace_name);
      return { title: t(`admin.notify.types.${key}.title`, vars), body: t(`admin.notify.types.${key}.body`, vars) };
    },
    [t],
  );

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/notifications", { cache: "no-store" }).catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json()) as { notifications: Item[]; unread: number };
    setItems(data.notifications);
    setUnread(data.unread);
    const latest = data.notifications[0];
    if (latest && newest.current && latest.created_at > newest.current) {
      const fresh = data.notifications.filter((n) => !n.read && n.created_at > newest.current!);
      if (fresh.length) {
        if (soundEnabled()) playChime();
        const first = text(fresh[0]);
        showDesktop({ id: fresh[0].id, title: first.title, body: first.body }, () => router.push(notificationLink(fresh[0].type)));
      }
    }
    if (latest && (!newest.current || latest.created_at > newest.current)) newest.current = latest.created_at;
  }, [router, text]);

  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      if (!cancelled) void load();
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [load]);

  async function markRead(body: { ids: string[] } | { all: true }) {
    setItems((prev) => prev.map((n) => ("all" in body || body.ids.includes(n.id) ? { ...n, read: true } : n)));
    const res = await fetch("/api/admin/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { unread?: number } | null;
    if (typeof data?.unread === "number") setUnread(data.unread);
  }

  const openItem = (n: Item) => {
    if (!n.read) void markRead({ ids: [n.id] });
    setOpen(false);
    router.push(notificationLink(n.type));
  };

  const dateLocale = locale === "en" ? enUS : esLocale;

  return (
    <Popover open={open} onOpenChange={(next) => { setOpen(next); if (next) void load(); }}>
      <PopoverTrigger
        aria-label={unread > 0 ? `${t("admin.notify.title")}, ${t("admin.notify.unread", { n: unread })}` : t("admin.notify.title")}
        className="relative flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
      >
        <Bell className="size-4" aria-hidden="true" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-none text-white" aria-hidden="true">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(24rem,calc(100vw-2rem))] gap-0 p-0">
        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
          <h2 className="text-sm font-semibold text-foreground">{t("admin.notify.title")}</h2>
          {unread > 0 && (
            <button type="button" onClick={() => void markRead({ all: true })} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-primary hover:underline">
              <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />
              {t("admin.notify.markAll")}
            </button>
          )}
        </div>
        {items.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-muted-foreground">{t("admin.notify.empty")}</p>
        ) : (
          <ul className="max-h-[60vh] overflow-y-auto py-1">
            {items.map((n) => {
              const { title, body } = text(n);
              return (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => openItem(n)}
                    className={cn("flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none", !n.read && "bg-primary/5")}
                  >
                    <span className="min-w-0 flex-1">
                      <span className={cn("block text-sm text-foreground", !n.read && "font-semibold")}>{title}</span>
                      {body && <span className="line-clamp-2 block text-xs text-muted-foreground">{body}</span>}
                      <span className="mt-0.5 block text-[11px] text-muted-foreground">
                        {formatDistanceToNow(new Date(n.created_at), { addSuffix: true, locale: dateLocale })}
                      </span>
                    </span>
                    {!n.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" aria-hidden="true" />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <div className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-2 text-xs">
          <button
            type="button"
            aria-pressed={sound}
            onClick={() => {
              setSoundEnabled(!sound);
              setSound(!sound);
            }}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            {sound ? <Volume2 className="h-3.5 w-3.5" aria-hidden="true" /> : <VolumeX className="h-3.5 w-3.5" aria-hidden="true" />}
            {sound ? t("inboxpro.notifications.soundOn") : t("inboxpro.notifications.soundOff")}
          </button>
          {desktop === "default" && (
            <button type="button" onClick={async () => setDesktop(await requestDesktopPermission())} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-primary hover:underline">
              <BellRing className="h-3.5 w-3.5" aria-hidden="true" />
              {t("inboxpro.notifications.enableDesktop")}
            </button>
          )}
          {desktop === "granted" && <span className="text-muted-foreground">{t("inboxpro.notifications.desktopOn")}</span>}
        </div>
      </PopoverContent>
    </Popover>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { LifeBuoy, Loader2, Send } from "lucide-react";
import { AdminShell } from "../admin-shell";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/utils";
import { TICKET_STATUSES } from "@/lib/support/input";
import { TicketThread, type ThreadMessage } from "@/components/support/ticket-thread";

interface Ticket {
  id: string;
  number: number;
  subject: string;
  category: string;
  priority: string;
  status: string;
  last_message_at: string;
  workspace_name: string;
  requester?: { email: string; name: string } | null;
}

const FILTERS = ["active", "open", "in_progress", "waiting_customer", "closed", "all"] as const;
const STATUS_DARK: Record<string, string> = {
  open: "bg-sky-500/15 text-sky-300",
  in_progress: "bg-violet-500/15 text-violet-300",
  waiting_customer: "bg-amber-500/15 text-amber-300",
  closed: "bg-slate-700 text-slate-300",
};

export default function AdminSupportPage() {
  const { t, locale } = useI18n();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("active");
  const [list, setList] = useState<{ tickets: Ticket[]; counts: Record<string, number> } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ ticket: Ticket; messages: ThreadMessage[] } | null>(null);
  const [reply, setReply] = useState("");
  const [nextStatus, setNextStatus] = useState("waiting_customer");
  const [busy, setBusy] = useState(false);
  const fmt = new Intl.DateTimeFormat(locale === "en" ? "en-US" : "es-PE", { dateStyle: "medium", timeStyle: "short" });

  const loadList = useCallback(async () => {
    const r = await fetch(`/api/admin/support/tickets${filter === "all" ? "" : `?status=${filter}`}`, { cache: "no-store" }).catch(() => null);
    setList(r?.ok ? await r.json() : { tickets: [], counts: {} });
  }, [filter]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on filter change
    void loadList();
  }, [loadList]);

  useEffect(() => {
    if (!selected) return;
    let alive = true;
    fetch(`/api/admin/support/tickets/${selected}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => alive && setDetail(d))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [selected]);

  const send = async () => {
    if (!detail || !reply.trim()) return;
    setBusy(true);
    const r = await fetch(`/api/admin/support/tickets/${detail.ticket.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body: reply, status: nextStatus }) });
    setBusy(false);
    if (r.ok) {
      setDetail(await r.json());
      setReply("");
      void loadList();
    }
  };

  const setStatus = async (status: string) => {
    if (!detail) return;
    const r = await fetch(`/api/admin/support/tickets/${detail.ticket.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
    if (r.ok) {
      setDetail(await r.json());
      void loadList();
    }
  };

  const active = (list?.counts.open ?? 0) + (list?.counts.in_progress ?? 0) + (list?.counts.waiting_customer ?? 0);

  return (
    <AdminShell>
      <div className="space-y-6">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-white">
            <LifeBuoy className="size-6 text-emerald-400" aria-hidden /> {t("supportAdmin.title")}
          </h1>
          <p className="mt-1 text-sm text-slate-400">{t("supportAdmin.subtitle")}</p>
        </div>

        <div role="tablist" className="flex flex-wrap gap-2">
          {FILTERS.map((f) => {
            const n = f === "active" ? active : f === "all" ? null : list?.counts[f] ?? 0;
            return (
              <button
                key={f}
                type="button"
                role="tab"
                aria-selected={filter === f}
                onClick={() => setFilter(f)}
                className={cn("rounded-full border px-3 py-1.5 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60", filter === f ? "border-emerald-500 bg-emerald-500/15 text-emerald-300" : "border-slate-700 text-slate-300 hover:bg-slate-800")}
              >
                {t(`supportAdmin.filters.${f}`)}
                {n !== null && <span className="ml-1.5 text-slate-400">{n}</span>}
              </button>
            );
          })}
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
          <section className="rounded-xl border border-slate-800 bg-slate-900">
            {!list ? (
              <div className="flex justify-center py-10"><Loader2 className="size-5 animate-spin text-slate-400" aria-label={t("common.loading")} /></div>
            ) : list.tickets.length === 0 ? (
              <p className="p-6 text-sm text-slate-400">{t("supportAdmin.empty")}</p>
            ) : (
              <ul className="divide-y divide-slate-800">
                {list.tickets.map((tk) => (
                  <li key={tk.id}>
                    <button type="button" onClick={() => setSelected(tk.id)} aria-current={selected === tk.id} className={cn("flex w-full flex-col gap-1 px-4 py-3 text-left hover:bg-slate-800/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60", selected === tk.id && "bg-slate-800")}>
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-xs text-slate-400">#{tk.number} · {tk.workspace_name}</span>
                        <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", STATUS_DARK[tk.status])}>{t(`support.status.${tk.status}`)}</span>
                      </span>
                      <span className="line-clamp-1 text-sm font-medium text-white">{tk.subject}</span>
                      <span className="text-xs text-slate-500">
                        {t(`support.category.${tk.category}`)} · {t(`support.priority.${tk.priority}`)} · {fmt.format(new Date(tk.last_message_at))}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
            {!detail ? (
              <p className="text-sm text-slate-400">{t("supportAdmin.select")}</p>
            ) : (
              <div className="flex flex-col gap-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold text-white">#{detail.ticket.number} · {detail.ticket.subject}</h2>
                    <p className="text-xs text-slate-400">
                      {detail.ticket.workspace_name} · {t("supportAdmin.requester")}: {detail.ticket.requester?.name || "—"} &lt;{detail.ticket.requester?.email ?? ""}&gt;
                    </p>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-slate-300">
                    {t("supportAdmin.status")}
                    <select value={detail.ticket.status} onChange={(e) => void setStatus(e.target.value)} className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm text-white">
                      {TICKET_STATUSES.map((s) => <option key={s} value={s}>{t(`support.status.${s}`)}</option>)}
                    </select>
                  </label>
                </div>
                <div className="rounded-lg bg-slate-950/40 p-3 text-slate-100 [&_.bg-muted]:bg-slate-800 [&_.text-foreground]:text-slate-100 [&_.text-muted-foreground]:text-slate-400">
                  <TicketThread messages={detail.messages} side="support" labels={{ customer: t("supportAdmin.customer"), support: t("supportAdmin.team") }} locale={locale} />
                </div>
                <div className="grid gap-2">
                  <label htmlFor="adm-reply" className="text-xs font-semibold uppercase tracking-wide text-slate-300">{t("supportAdmin.reply")}</label>
                  <textarea id="adm-reply" rows={4} value={reply} onChange={(e) => setReply(e.target.value)} maxLength={10000} placeholder={t("supportAdmin.replyPlaceholder")} className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none" />
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <label className="flex items-center gap-2 text-xs text-slate-300">
                      {t("supportAdmin.sendAs")}
                      <select value={nextStatus} onChange={(e) => setNextStatus(e.target.value)} className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm text-white">
                        {TICKET_STATUSES.map((s) => <option key={s} value={s}>{t(`support.status.${s}`)}</option>)}
                      </select>
                    </label>
                    <button type="button" onClick={send} disabled={busy || !reply.trim()} className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-500 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400">
                      {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Send className="size-4" aria-hidden />}
                      {t("supportAdmin.send")}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </AdminShell>
  );
}

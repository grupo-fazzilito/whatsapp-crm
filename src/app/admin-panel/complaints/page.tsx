"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { BookOpen, ExternalLink, Loader2, Send } from "lucide-react";
import { AdminShell } from "../admin-shell";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/utils";
import type { ComplaintView } from "@/lib/complaints/server";

const FILTERS = ["pending", "answered", "all"] as const;
const STATUS_DARK: Record<string, string> = {
  pending: "bg-amber-500/15 text-amber-300",
  answered: "bg-emerald-500/15 text-emerald-300",
};

export default function AdminComplaintsPage() {
  const { t, locale } = useI18n();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("pending");
  const [list, setList] = useState<{ complaints: ComplaintView[]; counts: Record<string, number> } | null>(null);
  const [selected, setSelected] = useState<ComplaintView | null>(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const lc = locale === "en" ? "en-US" : "es-PE";
  const fmt = new Intl.DateTimeFormat(lc, { dateStyle: "medium", timeStyle: "short", timeZone: "America/Lima" });
  const day = (ymd: string) => new Intl.DateTimeFormat(lc, { dateStyle: "medium", timeZone: "America/Lima" }).format(new Date(`${ymd}T12:00:00-05:00`));
  const [todayLima] = useState(() => new Date(Date.now() - 5 * 3600_000).toISOString().slice(0, 10));

  const loadList = useCallback(async () => {
    const r = await fetch(`/api/admin/complaints${filter === "all" ? "" : `?status=${filter}`}`, { cache: "no-store" }).catch(() => null);
    setList(r?.ok ? await r.json() : { complaints: [], counts: {} });
  }, [filter]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on filter change
    void loadList();
  }, [loadList]);

  const send = async () => {
    if (!selected || reply.trim().length < 10) return;
    setBusy(true);
    setFailed(false);
    const r = await fetch(`/api/admin/complaints/${selected.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ response: reply }) }).catch(() => null);
    setBusy(false);
    if (r?.ok) {
      setSelected((await r.json()).complaint);
      setReply("");
      void loadList();
    } else setFailed(true);
  };

  const due = (c: ComplaintView) =>
    c.status === "answered" && c.responded_at
      ? <span className="text-emerald-300">{t("complaintsAdmin.answeredOn", { date: fmt.format(new Date(c.responded_at)) })}</span>
      : c.due_date < todayLima
        ? <span className="font-semibold text-red-400">{t("complaintsAdmin.overdue", { date: day(c.due_date) })}</span>
        : <span>{t("complaintsAdmin.due", { date: day(c.due_date) })}</span>;

  return (
    <AdminShell>
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold text-white">
              <BookOpen className="size-6 text-emerald-400" aria-hidden /> {t("complaintsAdmin.title")}
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-400">{t("complaintsAdmin.subtitle")}</p>
          </div>
          <a href="/es/libro-de-reclamaciones" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-400 hover:text-emerald-300">
            {t("complaintsAdmin.publicLink")} <ExternalLink className="size-3.5" aria-hidden />
          </a>
        </div>

        <div role="tablist" className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              role="tab"
              aria-selected={filter === f}
              onClick={() => setFilter(f)}
              className={cn("rounded-full border px-3 py-1.5 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60", filter === f ? "border-emerald-500 bg-emerald-500/15 text-emerald-300" : "border-slate-700 text-slate-300 hover:bg-slate-800")}
            >
              {t(`complaintsAdmin.filters.${f}`)}
              {f !== "all" && <span className="ml-1.5 text-slate-400">{list?.counts[f] ?? 0}</span>}
            </button>
          ))}
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
          <section className="rounded-xl border border-slate-800 bg-slate-900">
            {!list ? (
              <div className="flex justify-center py-10"><Loader2 className="size-5 animate-spin text-slate-400" aria-label={t("common.loading")} /></div>
            ) : list.complaints.length === 0 ? (
              <p className="p-6 text-sm text-slate-400">{t("complaintsAdmin.empty")}</p>
            ) : (
              <ul className="divide-y divide-slate-800">
                {list.complaints.map((c) => (
                  <li key={c.id}>
                    <button type="button" onClick={() => { setSelected(c); setReply(""); setFailed(false); }} aria-current={selected?.id === c.id} className={cn("flex w-full flex-col gap-1 px-4 py-3 text-left hover:bg-slate-800/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60", selected?.id === c.id && "bg-slate-800")}>
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-xs text-slate-400">N.° {c.code} · {t(`complaints.kinds.${c.kind}`)}</span>
                        <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", STATUS_DARK[c.status])}>{t(`complaintsAdmin.status.${c.status}`)}</span>
                      </span>
                      <span className="line-clamp-1 text-sm font-medium text-white">{c.consumer_name}</span>
                      <span className="text-xs text-slate-500">{due(c)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
            {!selected ? (
              <p className="text-sm text-slate-400">{t("complaintsAdmin.select")}</p>
            ) : (
              <div className="flex flex-col gap-5 text-sm text-slate-300">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold text-white">{t("complaints.sheet.number")} {selected.code}</h2>
                    <p className="text-xs text-slate-400">{fmt.format(new Date(selected.created_at))} · {due(selected)}</p>
                  </div>
                  <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", STATUS_DARK[selected.status])}>{t(`complaintsAdmin.status.${selected.status}`)}</span>
                </div>

                <Block title={t("complaints.sheet.consumer")}>
                  <p className="font-medium text-white">{selected.consumer_name}</p>
                  <p>{t(`complaints.docTypes.${selected.doc_type}`)} {selected.doc_number}</p>
                  <p>{selected.address}</p>
                  <p>{selected.email}{selected.phone ? ` · ${selected.phone}` : ""}</p>
                  {selected.is_minor && <p>{t("complaintsAdmin.minor")} · {t("complaints.fields.guardian_name")}: {selected.guardian_name}</p>}
                </Block>
                <Block title={t("complaints.sheet.item")}>
                  <p>{t(`complaints.itemTypes.${selected.item_type}`)}: {selected.item_description}</p>
                  {selected.amount !== null && <p>{t("complaints.sheet.amount")}: S/ {selected.amount.toFixed(2)}</p>}
                </Block>
                <Block title={`${t("complaints.sheet.detail")} · ${t(`complaints.kinds.${selected.kind}`)}`}>
                  <p className="whitespace-pre-wrap"><span className="text-slate-400">{t("complaints.fields.detail")}:</span> {selected.detail}</p>
                  <p className="whitespace-pre-wrap"><span className="text-slate-400">{t("complaints.fields.request")}:</span> {selected.request}</p>
                </Block>

                {selected.status === "answered" ? (
                  <Block title={t("complaints.sheet.response")}>
                    <p className="whitespace-pre-wrap text-white">{selected.response}</p>
                  </Block>
                ) : (
                  <div className="grid gap-2">
                    <label htmlFor="cb-reply" className="text-xs font-semibold uppercase tracking-wide text-slate-300">{t("complaintsAdmin.response")}</label>
                    <textarea id="cb-reply" rows={5} value={reply} onChange={(e) => setReply(e.target.value)} maxLength={5000} placeholder={t("complaintsAdmin.responsePlaceholder")} className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none" />
                    {failed && <p role="alert" className="text-xs text-red-400">{t("complaintsAdmin.sendFailed")}</p>}
                    <div className="flex justify-end">
                      <button type="button" onClick={send} disabled={busy || reply.trim().length < 10} className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-500 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400">
                        {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Send className="size-4" aria-hidden />}
                        {t("complaintsAdmin.send")}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </AdminShell>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{title}</h3>
      {children}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { Coins, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AdminShell } from "../admin-shell";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/utils";

interface Row {
  id: string;
  name: string;
  industry: string;
  balance: number;
  sales_month: number;
  credits_used_month: number;
  ai_cost_usd_month: number;
}

interface Payment {
  id: string;
  amount: number;
  credits: number;
  status: string;
  provider_order_id: string | null;
  paid_at: string | null;
  error: string | null;
  created_at: string;
  workspace: { name: string } | null;
}

interface HistoryEntry {
  id: string;
  kind: string;
  credits: number;
  action: string | null;
  note: string | null;
  created_at: string;
  by: string | null;
  payment: { amount: number; order: string | null } | null;
}

interface History {
  ledger: HistoryEntry[];
  lots: { id: string; source: string; credits_total: number; credits_remaining: number; expires_at: string; note: string | null }[];
}

// Actions with a label in billing.costs; anything else (e.g. adjustments) shows as is.
const COST_ACTIONS = ["reply", "followup", "summary", "suggest", "transcription", "vision", "comment_reply", "playground", "reminder"];

interface Overview {
  totals: { sales_month: number; credits_used_month: number; ai_cost_usd_month: number; credits_outstanding: number };
  workspaces: Row[];
  payments: Payment[];
}

const inputCls =
  "w-full rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2.5 text-sm text-white placeholder:text-slate-400 focus:outline-none focus:border-emerald-500 focus-visible:ring-2 focus-visible:ring-emerald-500/50";

export default function AdminBillingPage() {
  const { t, locale } = useI18n();
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rate, setRate] = useState(3.75);
  const [adjusting, setAdjusting] = useState<Row | null>(null);
  const [form, setForm] = useState({ credits: "", note: "" });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<Row | null>(null);
  const [history, setHistory] = useState<History | null>(null);
  const [withUsage, setWithUsage] = useState(false);

  const nf = new Intl.NumberFormat(locale === "en" ? "en-US" : "es-PE");
  const pen = (n: number) => `S/ ${new Intl.NumberFormat(locale === "en" ? "en-US" : "es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)}`;
  const usd = (n: number) => `US$ ${n.toFixed(n < 1 ? 4 : 2)}`;

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/billing", { cache: "no-store" });
    if (!res.ok) return setError(t("common.error"));
    setData(await res.json());
  }, [t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    void load();
  }, [load]);

  useEffect(() => {
    if (!viewing) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset while the next history loads
    setHistory(null);
    fetch(`/api/admin/billing/${viewing.id}?usage=${withUsage ? 1 : 0}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: History) => !cancelled && setHistory(d))
      .catch(() => !cancelled && setHistory({ ledger: [], lots: [] }));
    return () => {
      cancelled = true;
    };
  }, [viewing, withUsage]);

  const dt = (iso: string) => new Date(iso).toLocaleString(locale === "en" ? "en-US" : "es-PE");

  const submit = async () => {
    if (!adjusting) return;
    setBusy(true);
    setFormError(null);
    const res = await fetch("/api/admin/billing/adjust", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspace_id: adjusting.id, credits: Number(form.credits), note: form.note }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setFormError(body.error ?? t("common.error"));
    setAdjusting(null);
    setForm({ credits: "", note: "" });
    await load();
  };

  const tot = data?.totals;
  const margin = tot ? tot.sales_month - tot.ai_cost_usd_month * rate : 0;

  return (
    <AdminShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Coins className="size-6 text-emerald-400" aria-hidden /> {t("billingAdmin.pageTitle")}
          </h1>
          <p className="mt-1 text-sm text-slate-400">{t("billingAdmin.pageSubtitle")}</p>
        </div>

        {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
        {!data && !error && <Loader2 className="size-5 animate-spin text-slate-400" aria-label={t("common.loading")} />}

        {data && tot && (
          <>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
              {[
                [t("billingAdmin.salesMonth"), pen(tot.sales_month)],
                [t("billingAdmin.usedMonth"), nf.format(tot.credits_used_month)],
                [t("billingAdmin.aiCostMonth"), usd(tot.ai_cost_usd_month)],
                [t("billingAdmin.margin"), pen(margin)],
                [t("billingAdmin.outstanding"), nf.format(tot.credits_outstanding)],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl border border-slate-800 bg-slate-900 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
                  <p className="mt-1 text-xl font-bold text-white tabular-nums">{value}</p>
                </div>
              ))}
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-400">
              {t("billingAdmin.exchange")}
              <input type="number" step="0.01" min="1" value={rate} onChange={(e) => setRate(Number(e.target.value) || 3.75)} className="w-24 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-sm text-white focus:outline-none focus:border-emerald-500 focus-visible:ring-2 focus-visible:ring-emerald-500/50" />
            </label>

            <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-800">
                    {[t("billingAdmin.workspace"), t("billingAdmin.balance"), t("billingAdmin.salesMonth"), t("billingAdmin.usedMonth"), t("billingAdmin.aiCostMonth")].map((h) => (
                      <th key={h} scope="col" className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide whitespace-nowrap">{h}</th>
                    ))}
                    <th scope="col" className="px-4 py-3"><span className="sr-only">{t("common.actions")}</span></th>
                  </tr>
                </thead>
                <tbody>
                  {data.workspaces.map((w) => (
                    <tr key={w.id} className="border-b border-slate-800/60 last:border-0">
                      <td className="px-4 py-3 text-white">
                        {w.name}
                        <span className="ml-2 text-xs text-slate-500">{w.industry}</span>
                      </td>
                      <td className={cn("px-4 py-3 tabular-nums", w.balance <= 0 ? "text-red-300" : "text-slate-200")}>{nf.format(w.balance)}</td>
                      <td className="px-4 py-3 tabular-nums text-slate-200">{pen(w.sales_month)}</td>
                      <td className="px-4 py-3 tabular-nums text-slate-200">{nf.format(w.credits_used_month)}</td>
                      <td className="px-4 py-3 tabular-nums text-slate-200">{usd(w.ai_cost_usd_month)}</td>
                      <td className="px-4 py-3 text-right whitespace-nowrap space-x-2">
                        <button
                          type="button"
                          onClick={() => setViewing(w)}
                          className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
                        >
                          {t("billingAdmin.history")}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setAdjusting(w);
                            setFormError(null);
                          }}
                          className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
                        >
                          {t("billingAdmin.adjust")}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <section aria-labelledby="latest-payments" className="space-y-3">
              <h2 id="latest-payments" className="text-sm font-bold text-white">{t("billingAdmin.latestPayments")}</h2>
              {data.payments.length === 0 ? (
                <p className="text-sm text-slate-400">{t("billingAdmin.noPayments")}</p>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900">
                  <table className="w-full text-sm">
                    <tbody>
                      {data.payments.map((p) => (
                        <tr key={p.id} className="border-b border-slate-800/60 last:border-0">
                          <td className="px-4 py-2.5 whitespace-nowrap text-slate-300">{new Date(p.created_at).toLocaleString(locale === "en" ? "en-US" : "es-PE")}</td>
                          <td className="px-4 py-2.5 text-white">{p.workspace?.name ?? "—"}</td>
                          <td className="px-4 py-2.5 tabular-nums text-slate-200">{pen(Number(p.amount))}</td>
                          <td className="px-4 py-2.5 tabular-nums text-slate-200">{nf.format(p.credits)}</td>
                          <td className="px-4 py-2.5 text-slate-200">{t(`billing.status.${p.status}`)}</td>
                          <td className="px-4 py-2.5 font-mono text-xs text-slate-400">{p.provider_order_id ?? ""}</td>
                          <td className="px-4 py-2.5 text-xs text-red-300">{p.error ?? ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}

        <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
            <DialogHeader>
              <DialogTitle>{viewing ? t("billingAdmin.historyTitle", { name: viewing.name }) : ""}</DialogTitle>
            </DialogHeader>
            {!history ? (
              <Loader2 className="size-5 animate-spin text-slate-400" aria-label={t("common.loading")} />
            ) : (
              <div className="space-y-5">
                <section aria-labelledby="live-lots" className="space-y-2">
                  <h3 id="live-lots" className="text-xs font-semibold uppercase tracking-wide text-slate-400">{t("billingAdmin.liveLots")}</h3>
                  {history.lots.length === 0 ? (
                    <p className="text-sm text-slate-400">{t("billingAdmin.noLots")}</p>
                  ) : (
                    <ul className="divide-y divide-slate-800 rounded-xl border border-slate-800 text-sm">
                      {history.lots.map((l) => (
                        <li key={l.id} className="flex items-center justify-between gap-4 px-3 py-2">
                          <span className="min-w-0 text-slate-200">
                            {t(`billing.usage.kind.${l.source}`)}
                            {l.note && <span className="text-slate-400"> · {l.note}</span>}
                          </span>
                          <span className="shrink-0 text-xs text-slate-400 tabular-nums">
                            {t("billingAdmin.lotLeft", { left: nf.format(l.credits_remaining), total: nf.format(l.credits_total), date: new Date(l.expires_at).toLocaleDateString(locale === "en" ? "en-US" : "es-PE") })}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section aria-labelledby="ledger" className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 id="ledger" className="text-xs font-semibold uppercase tracking-wide text-slate-400">{t("billingAdmin.movements")}</h3>
                    <label className="flex items-center gap-2 text-xs text-slate-300">
                      <input type="checkbox" checked={withUsage} onChange={(e) => setWithUsage(e.target.checked)} className="size-4 accent-emerald-500" />
                      {t("billingAdmin.includeUsage")}
                    </label>
                  </div>
                  {history.ledger.length === 0 ? (
                    <p className="text-sm text-slate-400">{t("billingAdmin.noMovements")}</p>
                  ) : (
                    <div className="overflow-x-auto rounded-xl border border-slate-800">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-slate-800">
                            {[t("billingAdmin.colDate"), t("billingAdmin.colType"), t("billingAdmin.colTokens"), t("billingAdmin.colReason"), t("billingAdmin.colBy")].map((h) => (
                              <th key={h} scope="col" className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-400 whitespace-nowrap">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {history.ledger.map((l) => (
                            <tr key={l.id} className="border-b border-slate-800/60 last:border-0 align-top">
                              <td className="px-3 py-2 whitespace-nowrap text-slate-300">{dt(l.created_at)}</td>
                              <td className="px-3 py-2 text-slate-200">
                                {t(`billing.usage.kind.${l.kind}`)}
                                {l.action && <span className="text-slate-400"> · {COST_ACTIONS.includes(l.action) ? t(`billing.costs.${l.action}`) : l.action}</span>}
                              </td>
                              <td className={cn("px-3 py-2 tabular-nums font-medium whitespace-nowrap", l.credits > 0 ? "text-emerald-400" : "text-slate-300")}>
                                {l.credits > 0 ? "+" : ""}
                                {nf.format(l.credits)}
                              </td>
                              <td className="px-3 py-2 text-slate-300">
                                {l.note ?? ""}
                                {l.payment && <span className="text-slate-400">{l.note ? " · " : ""}{pen(l.payment.amount)}{l.payment.order ? ` · ${l.payment.order}` : ""}</span>}
                              </td>
                              <td className="px-3 py-2 text-slate-300">{l.by ?? t("billingAdmin.bySystem")}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              </div>
            )}
          </DialogContent>
        </Dialog>

        <Dialog open={!!adjusting} onOpenChange={(o) => !o && setAdjusting(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{adjusting ? t("billingAdmin.adjustTitle", { name: adjusting.name }) : ""}</DialogTitle>
            </DialogHeader>
            <div>
              <label htmlFor="adj-credits" className="block text-xs font-semibold text-slate-300 uppercase tracking-wide mb-1.5">{t("billingAdmin.adjustCredits")}</label>
              <input id="adj-credits" inputMode="numeric" value={form.credits} onChange={(e) => setForm((f) => ({ ...f, credits: e.target.value.replace(/[^\d-]/g, "") }))} className={inputCls} autoFocus />
            </div>
            <div>
              <label htmlFor="adj-note" className="block text-xs font-semibold text-slate-300 uppercase tracking-wide mb-1.5">{t("billingAdmin.adjustNote")}</label>
              <input id="adj-note" value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} maxLength={300} className={inputCls} />
            </div>
            {formError && <p role="alert" className="text-xs text-red-300">{formError}</p>}
            <DialogFooter>
              <button
                type="button"
                onClick={submit}
                disabled={busy || !form.credits || form.credits === "-" || !form.note.trim()}
                className="flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-2 text-sm font-bold text-white hover:bg-emerald-500 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
              >
                {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
                {t("billingAdmin.adjustSave")}
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AdminShell>
  );
}

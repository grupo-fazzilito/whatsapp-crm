"use client";

import { useCallback, useEffect, useState } from "react";
import { Coins, Loader2, X } from "lucide-react";
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
                      <td className="px-4 py-3 text-right">
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

        {adjusting && (
          <div role="dialog" aria-modal="true" aria-labelledby="adjust-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
            <div className="w-full max-w-md space-y-4 rounded-xl border border-slate-800 bg-slate-900 p-6">
              <div className="flex items-start justify-between gap-4">
                <h2 id="adjust-title" className="text-sm font-bold text-white">{t("billingAdmin.adjustTitle", { name: adjusting.name })}</h2>
                <button type="button" onClick={() => setAdjusting(null)} aria-label={t("common.cancel")} className="rounded p-1 text-slate-400 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60">
                  <X className="size-4" aria-hidden />
                </button>
              </div>
              <div>
                <label htmlFor="adj-credits" className="block text-xs font-semibold text-slate-300 uppercase tracking-wide mb-1.5">{t("billingAdmin.adjustCredits")}</label>
                <input id="adj-credits" inputMode="numeric" value={form.credits} onChange={(e) => setForm((f) => ({ ...f, credits: e.target.value.replace(/[^\d-]/g, "") }))} className={inputCls} autoFocus />
              </div>
              <div>
                <label htmlFor="adj-note" className="block text-xs font-semibold text-slate-300 uppercase tracking-wide mb-1.5">{t("billingAdmin.adjustNote")}</label>
                <input id="adj-note" value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} maxLength={300} className={inputCls} />
              </div>
              {formError && <p role="alert" className="text-xs text-red-300">{formError}</p>}
              <button
                type="button"
                onClick={submit}
                disabled={busy || !form.credits || form.credits === "-" || !form.note.trim()}
                className="flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2 text-sm font-bold text-white hover:bg-emerald-500 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
              >
                {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
                {t("billingAdmin.adjustSave")}
              </button>
            </div>
          </div>
        )}
      </div>
    </AdminShell>
  );
}

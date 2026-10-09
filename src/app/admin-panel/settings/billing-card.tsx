"use client";

import { useEffect, useState } from "react";
import { Coins, Loader2, PlugZap, Save } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/client";
import { BILLABLE_ACTIONS, type BillableAction, type BillingSettings } from "@/lib/billing/pricing";

interface PaymentLatamView {
  configured: boolean;
  base_url: string;
  effective_base_url: string;
  merchant_code: string;
  user_hint: string | null;
  pass_hint: string | null;
  amount_format: "fixed2" | "fixed1" | "plain";
  env_fallback: boolean;
}

const inputCls =
  "w-full rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2.5 text-sm text-white placeholder:text-slate-400 focus:outline-none focus:border-emerald-500 focus-visible:ring-2 focus-visible:ring-emerald-500/50 transition-colors";
const labelCls = "block text-xs font-semibold text-slate-300 uppercase tracking-wide mb-1.5";

/** Platform admin: credit prices + Payment Latam gateway. */
export function BillingCard() {
  const { t } = useI18n();
  const [billing, setBilling] = useState<BillingSettings | null>(null);
  const [packs, setPacks] = useState("");
  const [pl, setPl] = useState<PaymentLatamView | null>(null);
  const [plForm, setPlForm] = useState({ base_url: "", merchant_code: "", secret_user: "", secret_pass: "", amount_format: "fixed2" });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; error?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const apply = (d: { billing: BillingSettings; payment_latam: PaymentLatamView }) => {
    setBilling(d.billing);
    setPacks(d.billing.packs.join(", "));
    setPl(d.payment_latam);
    setPlForm({ base_url: d.payment_latam.base_url, merchant_code: d.payment_latam.merchant_code, secret_user: "", secret_pass: "", amount_format: d.payment_latam.amount_format });
  };

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/settings/billing", { cache: "no-store" }).then(async (res) => {
      if (cancelled) return;
      if (!res.ok) return setError(t("common.error"));
      apply(await res.json());
    });
    return () => {
      cancelled = true;
    };
  }, [t]);

  if (!billing || !pl) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-6">
        {error ? <p role="alert" className="text-xs text-red-300">{error}</p> : <Loader2 className="size-5 animate-spin text-slate-400" aria-label={t("common.loading")} />}
      </div>
    );
  }

  const setNum = (key: keyof BillingSettings, value: string) => setBilling((b) => (b ? { ...b, [key]: value === "" ? ("" as never) : Number(value) } : b));
  const setCost = (a: BillableAction, value: string) =>
    setBilling((b) => (b ? { ...b, action_costs: { ...b.action_costs, [a]: value === "" ? 0 : Number(value) } } : b));

  const save = async () => {
    setError(null);
    setSaving(true);
    const payment_latam: Record<string, unknown> = {
      base_url: plForm.base_url.trim() || null,
      merchant_code: plForm.merchant_code.trim() || null,
      amount_format: plForm.amount_format,
    };
    if (plForm.secret_user.trim()) payment_latam.secret_user = plForm.secret_user.trim();
    if (plForm.secret_pass.trim()) payment_latam.secret_pass = plForm.secret_pass.trim();
    const res = await fetch("/api/admin/settings/billing", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        billing: { ...billing, packs: packs.split(/[,\s]+/).filter(Boolean).map(Number) },
        payment_latam,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) return setError(data.error ?? t("common.error"));
    apply(data);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const runTest = async () => {
    setTesting(true);
    setTest(null);
    const res = await fetch("/api/admin/settings/billing/test", { method: "POST" });
    setTesting(false);
    setTest(await res.json().catch(() => ({ ok: false, error: t("common.error") })));
  };

  const num = (id: keyof BillingSettings, label: string, step = "1") => (
    <div>
      <label htmlFor={`bill-${id}`} className={labelCls}>{label}</label>
      <input id={`bill-${id}`} type="number" min="0" step={step} value={billing[id] as number} onChange={(e) => setNum(id, e.target.value)} className={inputCls} />
    </div>
  );

  const origin = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900 p-6 space-y-6" aria-labelledby="billing-admin-title">
      <div className="flex flex-wrap items-start gap-2">
        <div className="flex-1 min-w-0">
          <h2 id="billing-admin-title" className="text-sm font-bold text-white flex items-center gap-2">
            <Coins className="size-4 text-emerald-400" aria-hidden /> {t("billingAdmin.title")}
          </h2>
          <p className="mt-1 text-xs text-slate-400">{t("billingAdmin.subtitle")}</p>
        </div>
        <span
          className={cn(
            "rounded-full border px-2 py-0.5 text-[11px] font-medium",
            pl.configured ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-amber-500/30 bg-amber-500/10 text-amber-300",
          )}
        >
          {pl.configured ? t("billingAdmin.ready") : t("billingAdmin.incomplete")}
        </span>
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </p>
      )}

      <fieldset className="space-y-4">
        <legend className="text-xs font-bold uppercase tracking-wide text-slate-200 mb-3">{t("billingAdmin.prices")}</legend>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {num("credit_price", t("billingAdmin.creditPrice"), "0.001")}
          {num("min_topup", t("billingAdmin.minTopup"))}
          {num("expiry_months", t("billingAdmin.expiryMonths"))}
          {num("welcome_credits", t("billingAdmin.welcome"))}
          {num("low_credit_threshold", t("billingAdmin.lowThreshold"))}
          <div>
            <label htmlFor="bill-packs" className={labelCls}>{t("billingAdmin.packs")}</label>
            <input id="bill-packs" value={packs} onChange={(e) => setPacks(e.target.value)} className={inputCls} placeholder="50, 100, 200, 500" />
          </div>
        </div>
        <div>
          <p className={labelCls}>{t("billingAdmin.costs")}</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {BILLABLE_ACTIONS.map((a) => (
              <div key={a} className="flex items-center gap-2">
                <input
                  id={`bill-cost-${a}`}
                  type="number"
                  min="0"
                  step="1"
                  value={billing.action_costs[a]}
                  onChange={(e) => setCost(a, e.target.value)}
                  className={inputCls + " w-20"}
                />
                <label htmlFor={`bill-cost-${a}`} className="text-xs text-slate-300">{t(`billing.costs.${a}`)}</label>
              </div>
            ))}
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-200">
          <input type="checkbox" checked={billing.enforce} onChange={(e) => setBilling((b) => (b ? { ...b, enforce: e.target.checked } : b))} className="size-4 accent-emerald-500" />
          {t("billingAdmin.enforce")}
        </label>
      </fieldset>

      <fieldset className="space-y-4 border-t border-slate-800 pt-5">
        <legend className="text-xs font-bold uppercase tracking-wide text-slate-200 mb-3">{t("billingAdmin.gateway")}</legend>
        {pl.env_fallback && <p className="text-xs text-slate-400">{t("billingAdmin.envFallback")}</p>}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="pl-base" className={labelCls}>{t("billingAdmin.baseUrl")}</label>
            <input id="pl-base" value={plForm.base_url} onChange={(e) => setPlForm((f) => ({ ...f, base_url: e.target.value }))} placeholder={pl.effective_base_url} className={inputCls + " font-mono"} autoComplete="off" spellCheck={false} />
          </div>
          <div>
            <label htmlFor="pl-merchant" className={labelCls}>{t("billingAdmin.merchant")}</label>
            <input id="pl-merchant" value={plForm.merchant_code} onChange={(e) => setPlForm((f) => ({ ...f, merchant_code: e.target.value }))} className={inputCls + " font-mono"} autoComplete="off" spellCheck={false} />
          </div>
          {(["secret_user", "secret_pass"] as const).map((k) => {
            const hint = k === "secret_user" ? pl.user_hint : pl.pass_hint;
            return (
              <div key={k}>
                <label htmlFor={`pl-${k}`} className={labelCls}>
                  {hint ? t("billingAdmin.replaceSecret", { name: k === "secret_user" ? "secretUser" : "secretPass" }) : t(`billingAdmin.${k === "secret_user" ? "secretUser" : "secretPass"}`)}
                </label>
                <input
                  id={`pl-${k}`}
                  type="password"
                  value={plForm[k]}
                  onChange={(e) => setPlForm((f) => ({ ...f, [k]: e.target.value }))}
                  placeholder={hint ?? ""}
                  autoComplete="new-password"
                  spellCheck={false}
                  className={inputCls + " font-mono"}
                  aria-describedby={hint ? `pl-${k}-help` : undefined}
                />
                {hint && <p id={`pl-${k}-help`} className="mt-1 text-xs text-slate-400">{t("billingAdmin.secretSaved", { hint })}</p>}
              </div>
            );
          })}
          <div>
            <label htmlFor="pl-format" className={labelCls}>{t("billingAdmin.amountFormat")}</label>
            <select id="pl-format" value={plForm.amount_format} onChange={(e) => setPlForm((f) => ({ ...f, amount_format: e.target.value }))} className={inputCls} aria-describedby="pl-format-help">
              <option value="fixed2">50.00</option>
              <option value="fixed1">50.0</option>
              <option value="plain">50</option>
            </select>
            <p id="pl-format-help" className="mt-1 text-xs text-slate-400">{t("billingAdmin.amountFormatHelp")}</p>
          </div>
        </div>
        <p className="text-xs text-slate-400">{t("billingAdmin.webhookInfo", { url: origin })}</p>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={runTest}
            disabled={testing || !pl.configured}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-800 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
          >
            {testing ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <PlugZap className="size-3.5" aria-hidden />}
            {t("billingAdmin.test")}
          </button>
          {test && (
            <p role="status" className={cn("text-xs", test.ok ? "text-emerald-300" : "text-red-300")}>
              {test.ok ? t("billingAdmin.testOk") : t("billingAdmin.testFail", { error: test.error ?? "" })}
            </p>
          )}
        </div>
      </fieldset>

      <button
        type="button"
        onClick={save}
        disabled={saving}
        className="flex items-center gap-2 px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
      >
        {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Save className="size-4" aria-hidden />}
        {saved ? t("billingAdmin.saved") : t("billingAdmin.save")}
      </button>
    </section>
  );
}

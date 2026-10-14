"use client";

import Link from "next/link";
import { Check, Gift, Sparkles } from "lucide-react";
import { SpotlightCard } from "@/components/marketing/spotlight-card";
import { useI18n } from "@/i18n/client";
import { formatSoles, type PublicPricing } from "@/lib/billing/plans";

/** The plan(s) plus the AI tokens card. Used on the home page and on /pricing. */
export function PricingCards({ pricing }: { pricing: PublicPricing }) {
  const { t } = useI18n();
  const { credits } = pricing;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl mx-auto">
      {pricing.plans.map((plan) => (
        <SpotlightCard
          key={plan.id}
          interactive={true}
          className="border-emerald-500/50 shadow-lg shadow-emerald-950/5 relative"
          glowColor="rgba(16, 185, 129, 0.15)"
        >
          <div className="space-y-6 flex flex-col justify-between h-full">
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-[var(--m-text-tertiary)] uppercase tracking-widest">{plan.name}</span>
                <span className="bg-emerald-500 text-slate-950 text-[9px] font-extrabold uppercase px-2 py-0.5 rounded-full tracking-wider">
                  {t("mktPlans.plan.badge")}
                </span>
              </div>
              <h3 className="text-sm text-[var(--m-text-secondary)] font-semibold">{t("mktPlans.plan.tagline")}</h3>
              <div className="flex items-baseline gap-1.5 py-2 border-y border-[var(--m-border-primary)]/50">
                <span className="text-4xl font-extrabold text-[var(--m-text-heading)]">{formatSoles(plan.price)}</span>
                <span className="text-xs text-[var(--m-text-muted)]">{t("mktPlans.plan.period")}</span>
              </div>
              <ul className="space-y-2.5 text-xs text-[var(--m-text-tertiary)]">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <Check className="size-3.5 text-emerald-400 shrink-0 mt-0.5" />
                    <span>{t(`mktPlans.features.${f}`)}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="space-y-3 pt-2">
              <Link
                href="/signup"
                className="w-full py-3 rounded-xl text-xs font-bold transition-all text-center flex items-center justify-center gap-1.5 bg-emerald-500 text-slate-950 hover:bg-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.2)]"
              >
                {t("mktPlans.plan.cta")}
              </Link>
              <p className="text-[10px] text-[var(--m-text-muted)] text-center">{t("mktPlans.plan.note")}</p>
            </div>
          </div>
        </SpotlightCard>
      ))}

      <SpotlightCard interactive={true} className="border-[var(--m-border-primary)]/85" glowColor="rgba(148, 163, 184, 0.08)">
        <div className="space-y-6 flex flex-col justify-between h-full">
          <div className="space-y-4">
            <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[var(--m-text-tertiary)] uppercase tracking-widest">
              <Sparkles className="size-3.5 text-emerald-400" /> {t("mktPlans.tokens.name")}
            </span>
            <h3 className="text-sm text-[var(--m-text-secondary)] font-semibold">{t("mktPlans.tokens.tagline")}</h3>
            <div className="flex items-baseline gap-1.5 py-2 border-y border-[var(--m-border-primary)]/50">
              <span className="text-4xl font-extrabold text-[var(--m-text-heading)]">{formatSoles(credits.price)}</span>
              <span className="text-xs text-[var(--m-text-muted)]">{t("mktPlans.tokens.unit")}</span>
            </div>
            <p className="text-xs text-[var(--m-text-tertiary)]">{t("mktPlans.tokens.equivalence")}</p>
            {credits.welcome > 0 && (
              <p className="flex items-center gap-2 text-xs font-semibold text-emerald-400">
                <Gift className="size-3.5 shrink-0" /> {t("mktPlans.tokens.welcome", { n: credits.welcome.toLocaleString("en-US") })}
              </p>
            )}
            <ul className="space-y-1.5 text-xs text-[var(--m-text-tertiary)]">
              {credits.packs.map((p) => (
                <li key={p.amount} className="flex justify-between gap-4 border-b border-[var(--m-border-primary)]/30 pb-1.5">
                  <span>{formatSoles(p.amount)}</span>
                  <span className="font-semibold text-[var(--m-text-secondary)]">{t("mktPlans.tokens.pack", { n: p.credits.toLocaleString("en-US") })}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="space-y-1 text-[10px] text-[var(--m-text-muted)] leading-relaxed">
            <p>{t("mktPlans.tokens.minimum", { min: formatSoles(credits.minTopup) })}</p>
            <p>{t("mktPlans.tokens.expiry", { months: credits.expiryMonths })}</p>
            <p>{t("mktPlans.tokens.payment")}</p>
          </div>
        </div>
      </SpotlightCard>
    </div>
  );
}

/** What each AI action costs, from the billing settings. */
export function TokenCosts({ pricing }: { pricing: PublicPricing }) {
  const { t } = useI18n();
  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="text-center space-y-2">
        <h2 className="text-2xl sm:text-3xl font-bold text-[var(--m-text-heading)]">{t("mktPlans.costs.title")}</h2>
        <p className="text-xs text-[var(--m-text-tertiary)]">{t("mktPlans.costs.subtitle")}</p>
      </div>
      <div className="rounded-2xl border border-[var(--m-border-primary)] bg-[var(--m-bg-secondary)]/10 overflow-hidden">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-[var(--m-border-primary)] bg-[var(--m-bg-secondary)]/40 text-[var(--m-text-secondary)] font-bold">
              <th className="p-4">{t("mktPlans.costs.action")}</th>
              <th className="p-4 text-right">{t("mktPlans.costs.cost")}</th>
            </tr>
          </thead>
          <tbody>
            {pricing.credits.costs.map((c) => (
              <tr key={c.action} className="border-b border-[var(--m-border-primary)]/50 last:border-0">
                <td className="p-4 font-semibold text-[var(--m-text-secondary)]">{t(`billing.costs.${c.action}`)}</td>
                <td className="p-4 text-right text-emerald-400 font-semibold">{t("billing.costs.unit", { n: c.credits })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-[var(--m-text-muted)] text-center leading-relaxed">{t("mktPlans.costs.free")}</p>
      <p className="text-[11px] text-[var(--m-text-muted)] text-center leading-relaxed">{t("mktPlans.metaFees")}</p>
    </div>
  );
}

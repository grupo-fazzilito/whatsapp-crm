"use client";

import React from "react";
import Link from "next/link";
import { Check, HelpCircle, Sparkles, X } from "lucide-react";
import { SpotlightCard } from "@/components/marketing/spotlight-card";
import { MagneticButton } from "@/components/marketing/magnetic-button";
import { BookDemoTrigger } from "@/components/marketing/book-demo-trigger";
import { useI18n } from "@/i18n/client";

export default function PricingPage() {
  const { t } = useI18n();
  const plans = [
    {
      name: t("mktPricing.plans.starter.name"),
      tagline: t("mktPricing.plans.starter.tagline"),
      price: "₹2,999",
      subtext: t("mktPricing.plans.starter.subtext"),
      setupFee: t("mktPricing.plans.starter.setupFee"),
      ctaText: t("mktPricing.plans.starter.cta"),
      ctaLink: "/login",
      ctaType: "link",
      popular: false,
      footerText: t("mktPricing.plans.starter.footer")
    },
    {
      name: t("mktPricing.plans.growth.name"),
      tagline: t("mktPricing.plans.growth.tagline"),
      price: "₹9,999",
      subtext: t("mktPricing.plans.growth.subtext"),
      setupFee: t("mktPricing.plans.growth.setupFee"),
      ctaText: t("mktPricing.plans.growth.cta"),
      ctaType: "trigger",
      popular: true,
      badge: t("mktPricing.plans.growth.badge"),
      footerText: t("mktPricing.plans.growth.footer")
    },
    {
      name: t("mktPricing.plans.managed.name"),
      tagline: t("mktPricing.plans.managed.tagline"),
      price: "₹29,999",
      subtext: t("mktPricing.plans.managed.subtext"),
      setupFee: t("mktPricing.plans.managed.setupFee"),
      ctaText: t("mktPricing.plans.managed.cta"),
      ctaType: "trigger",
      popular: false,
      badge: t("mktPricing.plans.managed.badge"),
      footerText: t("mktPricing.plans.managed.footer")
    }
  ];

  const features = {
    platform: {
      title: t("mktPricing.sections.platform"),
      rows: [
        { name: t("mktPricing.rows.builder"), starter: "check", growth: "check", managed: "check" },
        { name: t("mktPricing.rows.aiAssistant"), starter: "DIY", growth: "DIY", managed: t("mktPricing.values.weConfigure") },
        { name: t("mktPricing.rows.inbox"), starter: "check", growth: "check", managed: "check" },
        { name: t("mktPricing.rows.integrations"), starter: "check", growth: "check", managed: "check" },
        { name: t("mktPricing.rows.markup"), starter: "check", growth: "check", managed: "check" },
        { name: t("mktPricing.rows.ctwa"), starter: "check", growth: "check", managed: "check" }
      ]
    },
    setup: {
      title: t("mktPricing.sections.setup"),
      rows: [
        { name: t("mktPricing.rows.metaVerification"), starter: "DIY", growth: "DIY", managed: "check" },
        { name: t("mktPricing.rows.numberConnection"), starter: "DIY", growth: "check", managed: "check" },
        { name: t("mktPricing.rows.coexistence"), starter: "DIY", growth: "check", managed: "check" },
        { name: t("mktPricing.rows.platformConfig"), starter: "DIY", growth: "check", managed: "check" },
        { name: t("mktPricing.rows.kickoff"), starter: "DIY", growth: "check", managed: "check" },
        { name: t("mktPricing.rows.automationsBuilt"), starter: "DIY", growth: "DIY", managed: t("mktPricing.values.coreAutomations") },
        { name: t("mktPricing.rows.templates"), starter: "DIY", growth: "DIY", managed: "check" },
        { name: t("mktPricing.rows.integrationsWired"), starter: "DIY", growth: "DIY", managed: "check" }
      ]
    },
    support: {
      title: t("mktPricing.sections.support"),
      rows: [
        { name: t("mktPricing.rows.supportGroup"), starter: "check", growth: "check", managed: "check" },
        { name: t("mktPricing.rows.groupQa"), starter: "check", growth: "check", managed: "check" },
        { name: t("mktPricing.rows.strategyCall"), starter: "DIY", growth: t("mktPricing.values.onboardingCall"), managed: t("mktPricing.values.monthlyDeepDive") },
        { name: t("mktPricing.rows.fastTrack"), starter: "DIY", growth: "DIY", managed: "check" },
        { name: t("mktPricing.rows.accountManager"), starter: "DIY", growth: "DIY", managed: "check" }
      ]
    }
  };

  const renderValue = (val: string) => {
    if (val === "check") {
      return (
        <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-500/10 text-emerald-400">
          <Check className="size-3.5" />
        </span>
      );
    }
    if (val === "DIY") {
      return <span className="text-xs font-semibold px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-[var(--m-text-tertiary)]">{t("mktPricing.compare.diy")}</span>;
    }
    return <span className="text-xs font-semibold px-2.5 py-1 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">{val}</span>;
  };

  return (
    <div className="w-full max-w-6xl mx-auto px-4 md:px-6 py-20 space-y-24">
      {/* Page Header */}
      <div className="text-center space-y-4 max-w-3xl mx-auto">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-emerald-500/25 bg-[var(--m-badge-bg)] text-emerald-500 text-[10px] font-bold uppercase tracking-wider">
          <Sparkles className="size-3" /> {t("mktPricing.badge")}
        </div>
        <h1 className="text-4xl sm:text-6xl font-extrabold text-[var(--m-text-heading)] tracking-tight leading-[1.1]">
          {t("mktPricing.titleLine1")} <br />
          <span className="bg-gradient-to-r from-emerald-400 to-teal-400 bg-clip-text text-transparent">
            {t("mktPricing.titleHighlight")}
          </span>
        </h1>
        <p className="text-sm text-[var(--m-text-tertiary)] max-w-xl mx-auto">
          {t("mktPricing.subtitle")}
        </p>
      </div>

      {/* Plan Selection Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {plans.map((plan) => (
          <SpotlightCard
            key={plan.name}
            interactive={true}
            className={plan.popular ? "border-emerald-500/50 shadow-lg shadow-emerald-950/5 relative" : "border-[var(--m-border-primary)]/85"}
            glowColor={plan.popular ? "rgba(16, 185, 129, 0.15)" : "rgba(148, 163, 184, 0.08)"}
          >
            {plan.badge && (
              <div className="absolute top-4 right-4 bg-emerald-500 text-slate-950 text-[9px] font-extrabold uppercase px-2 py-0.5 rounded-full tracking-wider">
                {plan.badge}
              </div>
            )}
            <div className="space-y-6 flex flex-col justify-between h-full">
              <div className="space-y-4">
                <span className="text-xs font-bold text-[var(--m-text-tertiary)] uppercase tracking-widest">{plan.name}</span>
                <h4 className="text-sm text-[var(--m-text-secondary)] font-semibold min-h-[20px]">{plan.tagline}</h4>
                
                <div className="flex items-baseline gap-1 py-2 border-y border-[var(--m-border-primary)]/50">
                  <span className="text-3xl sm:text-4xl font-extrabold text-[var(--m-text-heading)]">{plan.price}</span>
                  <span className="text-xs text-[var(--m-text-muted)]">{plan.subtext}</span>
                </div>
                <div className="text-xs font-medium text-emerald-400/90">{plan.setupFee}</div>
              </div>

              <div className="space-y-4 pt-4">
                {plan.ctaType === "link" ? (
                  <Link
                    href={plan.ctaLink || "#"}
                    className="w-full py-3 rounded-xl text-xs font-bold transition-all text-center flex items-center justify-center gap-1.5 bg-emerald-500 text-slate-950 hover:bg-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.2)]"
                  >
                    {plan.ctaText}
                  </Link>
                ) : (
                  <BookDemoTrigger className="w-full py-3 rounded-xl text-xs font-bold transition-all text-center flex items-center justify-center gap-1.5 bg-[var(--m-bg-secondary)] border border-[var(--m-border-primary)] hover:bg-[var(--m-bg-tertiary)] text-[var(--m-text-secondary)]">
                    {plan.ctaText}
                  </BookDemoTrigger>
                )}
                <div className="text-[10px] text-[var(--m-text-muted)] text-center leading-relaxed">{plan.footerText}</div>
              </div>
            </div>
          </SpotlightCard>
        ))}
      </div>

      <div className="text-center pt-4">
        <p className="text-xs text-[var(--m-text-muted)] font-medium">{t("mktPricing.gstNote")}</p>
      </div>

      {/* Feature Comparison Matrix */}
      <div className="space-y-8 pt-8">
        <div className="text-center space-y-2">
          <h2 className="text-2xl sm:text-3xl font-bold text-[var(--m-text-heading)]">{t("mktPricing.compare.title")}</h2>
          <p className="text-xs text-[var(--m-text-tertiary)]">{t("mktPricing.compare.subtitle")}</p>
        </div>

        <div className="overflow-x-auto rounded-2xl border border-[var(--m-border-primary)] bg-[var(--m-bg-secondary)]/10 backdrop-blur-md">
          <table className="w-full min-w-[600px] border-collapse text-left">
            <thead>
              <tr className="border-b border-[var(--m-border-primary)] bg-[var(--m-bg-secondary)]/40 text-[var(--m-text-secondary)] font-bold text-xs">
                <th className="p-4 w-[40%]">{t("mktPricing.compare.colFeature")}</th>
                <th className="p-4 text-center w-[20%]">{t("mktPricing.plans.starter.name")}</th>
                <th className="p-4 text-center w-[20%]">{t("mktPricing.plans.growth.name")}</th>
                <th className="p-4 text-center w-[20%]">{t("mktPricing.plans.managed.name")}</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(features).map(([key, section]) => (
                <React.Fragment key={key}>
                  <tr className="bg-[var(--m-bg-secondary)]/20 border-b border-[var(--m-border-primary)]">
                    <td colSpan={4} className="px-4 py-3 text-xs uppercase font-extrabold tracking-wider text-emerald-400">
                      {section.title}
                    </td>
                  </tr>
                  {section.rows.map((row, rIdx) => (
                    <tr 
                      key={rIdx} 
                      className="border-b border-[var(--m-border-primary)]/50 hover:bg-[var(--m-bg-secondary)]/15 transition-colors duration-150"
                    >
                      <td className="p-4 text-xs font-semibold text-[var(--m-text-secondary)]">{row.name}</td>
                      <td className="p-4 text-center">{renderValue(row.starter)}</td>
                      <td className="p-4 text-center">{renderValue(row.growth)}</td>
                      <td className="p-4 text-center">{renderValue(row.managed)}</td>
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Footer Callout */}
      <div className="text-center space-y-4">
        <BookDemoTrigger className="inline-flex items-center gap-1 text-sm font-semibold transition-colors text-emerald-500 hover:text-emerald-400">
          {t("mktPricing.notSure")}
        </BookDemoTrigger>
      </div>
    </div>
  );
}

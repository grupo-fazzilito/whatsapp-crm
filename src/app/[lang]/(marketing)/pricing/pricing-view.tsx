"use client";

import { Sparkles } from "lucide-react";
import { BookDemoTrigger } from "@/components/marketing/book-demo-trigger";
import { PricingCards, TokenCosts } from "@/components/marketing/pricing-cards";
import { useI18n } from "@/i18n/client";
import type { PublicPricing } from "@/lib/billing/plans";

export function PricingView({ pricing }: { pricing: PublicPricing }) {
  const { t } = useI18n();
  return (
    <div className="w-full max-w-6xl mx-auto px-4 md:px-6 py-20 space-y-24">
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
        <p className="text-sm text-[var(--m-text-tertiary)] max-w-xl mx-auto">{t("mktPricing.subtitle")}</p>
      </div>

      <PricingCards pricing={pricing} />

      <TokenCosts pricing={pricing} />

      <div className="text-center space-y-4">
        <BookDemoTrigger className="inline-flex items-center gap-1 text-sm font-semibold transition-colors text-emerald-500 hover:text-emerald-400">
          {t("mktPricing.notSure")}
        </BookDemoTrigger>
      </div>
    </div>
  );
}

"use client";

import React from "react";
import { Users, Sparkles, TrendingUp, ShieldAlert, BarChart2, ArrowRight } from "lucide-react";
import { SpotlightCard } from "@/components/marketing/spotlight-card";
import { CRMPreviewBoard } from "@/components/marketing/crm-preview-board";
import { useI18n } from "@/i18n/client";

export default function CRMPage() {
  const { t } = useI18n();
  return (
    <div className="w-full max-w-6xl mx-auto px-4 md:px-6 py-20 space-y-20">
      {/* Header */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
        <div className="space-y-6">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-emerald-500/25 bg-emerald-950/20 text-emerald-400 text-[10px] font-bold uppercase tracking-wider">
            <Users className="size-3.5" /> {t("mktCrm.badge")}
          </div>
          <h1 className="text-4xl sm:text-6xl font-extrabold text-[var(--m-text-heading)] tracking-tight leading-[1.08]">
            {t("mktCrm.titleLine1")} <br />
            <span className="bg-gradient-to-r from-emerald-400 to-teal-400 bg-clip-text text-transparent">
              {t("mktCrm.titleLine2")}
            </span>
          </h1>
          <p className="text-sm text-[var(--m-text-tertiary)] leading-relaxed">
            {t("mktCrm.subtitle")}
          </p>
        </div>

        {/* Visual CRM board mockup preview */}
        <div className="relative">
          <div className="absolute inset-0 bg-emerald-500/5 blur-[95px] pointer-events-none" />
          <CRMPreviewBoard />
        </div>
      </div>

      {/* Details list */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <SpotlightCard>
          <TrendingUp className="size-5 text-teal-400 mb-3" />
          <h4 className="text-sm font-bold text-[var(--m-text-secondary)]">{t("mktCrm.features.revenueTitle")}</h4>
          <p className="text-xs text-[var(--m-text-tertiary)] mt-2 leading-relaxed">
            {t("mktCrm.features.revenueDesc")}
          </p>
        </SpotlightCard>

        <SpotlightCard glowColor="rgba(16, 185, 129, 0.12)">
          <Sparkles className="size-5 text-emerald-400 mb-3" />
          <h4 className="text-sm font-bold text-[var(--m-text-secondary)]">{t("mktCrm.features.fieldsTitle")}</h4>
          <p className="text-xs text-[var(--m-text-tertiary)] mt-2 leading-relaxed">
            {t("mktCrm.features.fieldsDesc")}
          </p>
        </SpotlightCard>

        <SpotlightCard glowColor="rgba(20, 184, 166, 0.12)">
          <BarChart2 className="size-5 text-teal-400 mb-3" />
          <h4 className="text-sm font-bold text-[var(--m-text-secondary)]">{t("mktCrm.features.auditTitle")}</h4>
          <p className="text-xs text-[var(--m-text-tertiary)] mt-2 leading-relaxed">
            {t("mktCrm.features.auditDesc")}
          </p>
        </SpotlightCard>
      </div>
    </div>
  );
}

"use client";

import React from "react";
import { Sparkles, Users, Award, ShieldAlert, Bot } from "lucide-react";
import { SpotlightCard } from "@/components/marketing/spotlight-card";
import { useI18n } from "@/i18n/client";

export default function AboutPage() {
  const { t } = useI18n();
  return (
    <div className="w-full max-w-6xl mx-auto px-4 md:px-6 py-20 space-y-20">
      {/* Header */}
      <div className="text-center space-y-4 max-w-3xl mx-auto">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-emerald-500/25 bg-[var(--m-badge-bg)] text-emerald-500 text-[10px] font-bold uppercase tracking-wider">
          <Sparkles className="size-3 animate-pulse" /> {t("mktAbout.badge")}
        </div>
        <h1 className="text-4xl sm:text-6xl font-extrabold text-[var(--m-text-heading)] tracking-tight leading-[1.1]">
          {t("mktAbout.titleLine1")} <br />
          <span className="bg-gradient-to-r from-emerald-400 to-teal-400 bg-clip-text text-transparent">
            {t("mktAbout.titleHighlight")}
          </span>
        </h1>
        <p className="text-sm text-[var(--m-text-tertiary)] max-w-xl mx-auto">
          {t("mktAbout.subtitle")}
        </p>
      </div>

      {/* Core values grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <SpotlightCard>
          <Bot className="size-5 text-emerald-400 mb-3" />
          <h4 className="text-sm font-bold text-[var(--m-text-secondary)]">{t("mktAbout.v1Title")}</h4>
          <p className="text-xs text-[var(--m-text-tertiary)] mt-2 leading-relaxed">
            {t("mktAbout.v1Desc")}
          </p>
        </SpotlightCard>

        <SpotlightCard glowColor="rgba(20, 184, 166, 0.12)">
          <Users className="size-5 text-teal-400 mb-3" />
          <h4 className="text-sm font-bold text-[var(--m-text-secondary)]">{t("mktAbout.v2Title")}</h4>
          <p className="text-xs text-[var(--m-text-tertiary)] mt-2 leading-relaxed">
            {t("mktAbout.v2Desc")}
          </p>
        </SpotlightCard>

        <SpotlightCard glowColor="rgba(16, 185, 129, 0.12)">
          <Award className="size-5 text-emerald-400 mb-3" />
          <h4 className="text-sm font-bold text-[var(--m-text-secondary)]">{t("mktAbout.v3Title")}</h4>
          <p className="text-xs text-[var(--m-text-tertiary)] mt-2 leading-relaxed">
            {t("mktAbout.v3Desc")}
          </p>
        </SpotlightCard>
      </div>
    </div>
  );
}

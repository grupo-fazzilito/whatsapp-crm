"use client";

import React, { useState } from "react";
import { MessageSquare, Sparkles, Send, CheckCheck, Play, ArrowRight, BarChart2 } from "lucide-react";
import { SpotlightCard } from "@/components/marketing/spotlight-card";
import { useI18n } from "@/i18n/client";

export default function WhatsAppMarketingPage() {
  const { t } = useI18n();
  // null = untouched: show the localized sample text so it follows the language switch.
  const [broadcastNameInput, setBroadcastName] = useState<string | null>(null);
  const [templateTextInput, setTemplateText] = useState<string | null>(null);
  const broadcastName = broadcastNameInput ?? t("mktWaMarketing.sim.defaultCampaignName");
  const templateText = templateTextInput ?? t("mktWaMarketing.sim.defaultTemplate");

  return (
    <div className="w-full max-w-6xl mx-auto px-4 md:px-6 py-20 space-y-20">
      {/* Header */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
        <div className="space-y-6">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-emerald-500/25 bg-emerald-950/20 text-emerald-400 text-[10px] font-bold uppercase tracking-wider">
            <MessageSquare className="size-3.5" /> {t("mktWaMarketing.badge")}
          </div>
          <h1 className="text-4xl sm:text-6xl font-extrabold text-[var(--m-text-heading)] tracking-tight leading-[1.08]">
            {t("mktWaMarketing.titleLine1")} <br />
            <span className="bg-gradient-to-r from-emerald-400 to-teal-400 bg-clip-text text-transparent">
              {t("mktWaMarketing.titleLine2")}
            </span>
          </h1>
          <p className="text-sm text-[var(--m-text-tertiary)] leading-relaxed">
            {t("mktWaMarketing.subtitle")}
          </p>
        </div>

        {/* Visual Broadcast Simulator card */}
        <div className="relative">
          <div className="absolute inset-0 bg-emerald-500/5 blur-[95px] pointer-events-none" />
          <div className="rounded-2xl border border-[var(--m-border-primary)] bg-[var(--m-bg-glass)] p-6 backdrop-blur flex flex-col justify-between h-[360px] shadow-2xl relative z-10">
            {/* Header info */}
            <div className="flex items-center justify-between border-b border-[var(--m-border-primary)] pb-3">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded bg-emerald-500/10 flex items-center justify-center text-emerald-400">
                  <Send className="size-3.5" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-[var(--m-text-secondary)]">{t("mktWaMarketing.sim.title")}</h4>
                  <p className="text-[9px] text-[var(--m-text-muted)]">{t("mktWaMarketing.sim.subtitle")}</p>
                </div>
              </div>
              <span className="text-[8px] bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded px-1.5 font-bold">{t("mktWaMarketing.sim.approved")}</span>
            </div>

            {/* Inputs inside Simulator */}
            <div className="flex-1 space-y-4 pt-4">
              <div className="space-y-1.5">
                <label className="text-[10px] uppercase font-bold text-[var(--m-text-muted)]">{t("mktWaMarketing.sim.campaignName")}</label>
                <input
                  type="text"
                  value={broadcastName}
                  onChange={(e) => setBroadcastName(e.target.value)}
                  className="w-full bg-[var(--m-input-bg)] border border-[var(--m-input-border)] rounded-lg px-3 py-1.5 text-xs text-[var(--m-text-primary)] focus:outline-none focus:border-emerald-500/55"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] uppercase font-bold text-[var(--m-text-muted)]">{t("mktWaMarketing.sim.bodyText")}</label>
                <textarea
                  rows={3}
                  value={templateText}
                  onChange={(e) => setTemplateText(e.target.value)}
                  className="w-full bg-[var(--m-input-bg)] border border-[var(--m-input-border)] rounded-lg px-3 py-1.5 text-xs text-[var(--m-text-primary)] focus:outline-none focus:border-emerald-500/55 resize-none font-sans"
                />
              </div>
            </div>

            {/* Simulated actions */}
            <div className="flex items-center justify-between border-t border-[var(--m-border-primary)] pt-4 mt-2">
              <span className="text-[9px] text-[var(--m-text-muted)]">{t("mktWaMarketing.sim.recipients")}</span>
              <button className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold px-4 py-2 rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer">
                <Play className="size-3" /> {t("mktWaMarketing.sim.dispatch")}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Grid details */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <SpotlightCard>
          <CheckCheck className="size-5 text-emerald-400 mb-3" />
          <h4 className="text-sm font-bold text-[var(--m-text-secondary)]">{t("mktWaMarketing.features.receiptsTitle")}</h4>
          <p className="text-xs text-[var(--m-text-tertiary)] mt-2 leading-relaxed">
            {t("mktWaMarketing.features.receiptsDesc")}
          </p>
        </SpotlightCard>

        <SpotlightCard glowColor="rgba(16, 185, 129, 0.12)">
          <Sparkles className="size-5 text-emerald-400 mb-3" />
          <h4 className="text-sm font-bold text-[var(--m-text-secondary)]">{t("mktWaMarketing.features.variablesTitle")}</h4>
          <p className="text-xs text-[var(--m-text-tertiary)] mt-2 leading-relaxed">
            {t("mktWaMarketing.features.variablesDesc")}
          </p>
        </SpotlightCard>

        <SpotlightCard glowColor="rgba(20, 184, 166, 0.12)">
          <BarChart2 className="size-5 text-teal-400 mb-3" />
          <h4 className="text-sm font-bold text-[var(--m-text-secondary)]">{t("mktWaMarketing.features.optoutTitle")}</h4>
          <p className="text-xs text-[var(--m-text-tertiary)] mt-2 leading-relaxed">
            {t("mktWaMarketing.features.optoutDesc")}
          </p>
        </SpotlightCard>
      </div>
    </div>
  );
}

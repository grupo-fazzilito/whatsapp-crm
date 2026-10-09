"use client";

import React, { useState } from "react";
import { Bot, Sparkles, Brain, Check, Calendar, ArrowRight } from "lucide-react";
import { SpotlightCard } from "@/components/marketing/spotlight-card";
import { AIChatSimulation } from "@/components/marketing/ai-chat-simulation";
import { useI18n } from "@/i18n/client";

export default function AIAutomationPage() {
  const { t } = useI18n();
  const [modelType, setModelType] = useState<"gpt-4" | "claude-3" | "custom">("gpt-4");

  const prompts = {
    "gpt-4": t("mktAiAutomation.prompts.gpt4"),
    "claude-3": t("mktAiAutomation.prompts.claude3"),
    custom: t("mktAiAutomation.prompts.custom"),
  };

  return (
    <div className="w-full max-w-6xl mx-auto px-4 md:px-6 py-20 space-y-20">
      {/* Hero Header */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
        <div className="space-y-6">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-emerald-500/25 bg-[var(--m-badge-bg)] text-emerald-500 text-[10px] font-bold uppercase tracking-wider">
            <Bot className="size-3.5" /> {t("mktAiAutomation.badge")}
          </div>
          <h1 className="text-4xl sm:text-6xl font-extrabold text-[var(--m-text-heading)] tracking-tight leading-[1.08]">
            {t("mktAiAutomation.titleLine1")} <br />
            <span className="bg-gradient-to-r from-emerald-400 to-teal-400 bg-clip-text text-transparent">
              {t("mktAiAutomation.titleHighlight")}
            </span>
          </h1>
          <p className="text-sm text-[var(--m-text-tertiary)] leading-relaxed">
            {t("mktAiAutomation.subtitle")}
          </p>
        </div>

        {/* Live WhatsApp chat simulation visual */}
        <div className="relative">
          <div className="absolute inset-0 bg-emerald-500/5 blur-[90px] pointer-events-none" />
          <AIChatSimulation />
        </div>
      </div>

      {/* Models playground illustration */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-center border-t border-[var(--m-border-primary)] pt-16">
        <div className="space-y-4">
          <div className="inline-flex items-center gap-1 text-xs font-bold text-teal-400 uppercase tracking-wide">
            <Brain className="size-4" /> {t("mktAiAutomation.playground.eyebrow")}
          </div>
          <h3 className="text-2xl sm:text-3xl font-extrabold text-[var(--m-text-primary)] tracking-tight">
            {t("mktAiAutomation.playground.title")}
          </h3>
          <p className="text-xs text-[var(--m-text-tertiary)] leading-relaxed">
            {t("mktAiAutomation.playground.desc")}
          </p>

          {/* Model selector toggles */}
          <div className="flex flex-col gap-2 pt-2">
            {(["gpt-4", "claude-3", "custom"] as const).map((model) => (
              <button
                key={model}
                onClick={() => setModelType(model)}
                className={`text-left px-4 py-2.5 rounded-lg border text-xs font-bold transition-all cursor-pointer ${
                  modelType === model
                    ? "bg-[var(--m-bg-secondary)] border-emerald-500/50 text-emerald-400 shadow-md"
                    : "bg-[var(--m-bg-card)] border-[var(--m-border-glass)] text-[var(--m-text-muted)] hover:text-[var(--m-text-secondary)]"
                }`}
              >
                {model === "gpt-4" ? t("mktAiAutomation.playground.modelGpt") : model === "claude-3" ? t("mktAiAutomation.playground.modelClaude") : t("mktAiAutomation.playground.modelCustom")}
              </button>
            ))}
          </div>
        </div>

        <div className="lg:col-span-2 rounded-xl border border-[var(--m-border-primary)] bg-[var(--m-bg-glass)] p-6 backdrop-blur flex flex-col h-[280px]">
          <span className="text-[9px] uppercase font-bold text-[var(--m-text-muted)] font-mono">{t("mktAiAutomation.playground.promptLabel")}</span>
          <div className="flex-1 bg-[var(--m-bg-secondary)]/50 border border-[var(--m-border-glass)] rounded-lg p-4 mt-3 text-xs text-[var(--m-text-secondary)] font-mono leading-relaxed overflow-y-auto">
            {prompts[modelType]}
          </div>
          <div className="flex items-center justify-between border-t border-[var(--m-border-primary)] pt-4 mt-4">
            <span className="text-[10px] text-[var(--m-text-muted)]">{t("mktAiAutomation.playground.autoSave")}</span>
            <span className="text-[10px] bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded px-2 py-0.5 font-bold">{t("mktAiAutomation.playground.active")}</span>
          </div>
        </div>
      </div>

      {/* Grid of benefits */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <SpotlightCard>
          <Calendar className="size-5 text-emerald-400 mb-3" />
          <h4 className="text-sm font-bold text-[var(--m-text-secondary)]">{t("mktAiAutomation.benefits.calendarTitle")}</h4>
          <p className="text-xs text-[var(--m-text-tertiary)] mt-2 leading-relaxed">
            {t("mktAiAutomation.benefits.calendarDesc")}
          </p>
        </SpotlightCard>

        <SpotlightCard glowColor="rgba(20, 184, 166, 0.12)">
          <Brain className="size-5 text-teal-400 mb-3" />
          <h4 className="text-sm font-bold text-[var(--m-text-secondary)]">{t("mktAiAutomation.benefits.vectorTitle")}</h4>
          <p className="text-xs text-[var(--m-text-tertiary)] mt-2 leading-relaxed">
            {t("mktAiAutomation.benefits.vectorDesc")}
          </p>
        </SpotlightCard>

        <SpotlightCard glowColor="rgba(16, 185, 129, 0.12)">
          <Bot className="size-5 text-emerald-400 mb-3" />
          <h4 className="text-sm font-bold text-[var(--m-text-secondary)]">{t("mktAiAutomation.benefits.handoffTitle")}</h4>
          <p className="text-xs text-[var(--m-text-tertiary)] mt-2 leading-relaxed">
            {t("mktAiAutomation.benefits.handoffDesc")}
          </p>
        </SpotlightCard>
      </div>
    </div>
  );
}

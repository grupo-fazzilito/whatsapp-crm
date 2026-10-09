"use client";

import React from "react";
import { Sparkles, Bot, Users, MessageSquare, Layers, Calendar, Network, Zap } from "lucide-react";
import { SpotlightCard } from "@/components/marketing/spotlight-card";
import { useI18n } from "@/i18n/client";

export default function AboutUsPage() {
  const { t } = useI18n();
  const services = [
    {
      title: t("mktAboutUs.services.crmTitle"),
      desc: t("mktAboutUs.services.crmDesc"),
      icon: Layers,
      glow: "rgba(16, 185, 129, 0.12)",
    },
    {
      title: t("mktAboutUs.services.leadsTitle"),
      desc: t("mktAboutUs.services.leadsDesc"),
      icon: Users,
      glow: "rgba(20, 184, 166, 0.12)",
    },
    {
      title: t("mktAboutUs.services.botsTitle"),
      desc: t("mktAboutUs.services.botsDesc"),
      icon: Bot,
      glow: "rgba(16, 185, 129, 0.12)",
    },
    {
      title: t("mktAboutUs.services.apptTitle"),
      desc: t("mktAboutUs.services.apptDesc"),
      icon: Calendar,
      glow: "rgba(20, 184, 166, 0.12)",
    },
    {
      title: t("mktAboutUs.services.supportTitle"),
      desc: t("mktAboutUs.services.supportDesc"),
      icon: MessageSquare,
      glow: "rgba(16, 185, 129, 0.12)",
    },
    {
      title: t("mktAboutUs.services.workflowTitle"),
      desc: t("mktAboutUs.services.workflowDesc"),
      icon: Network,
      glow: "rgba(20, 184, 166, 0.12)",
    },
    {
      title: t("mktAboutUs.services.teamTitle"),
      desc: t("mktAboutUs.services.teamDesc"),
      icon: Zap,
      glow: "rgba(16, 185, 129, 0.12)",
    },
  ];

  return (
    <div className="w-full max-w-6xl mx-auto px-4 md:px-6 py-20 space-y-20">
      {/* Header */}
      <div className="text-center space-y-4 max-w-3xl mx-auto">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-emerald-500/25 bg-[var(--m-badge-bg)] text-emerald-500 text-[10px] font-bold uppercase tracking-wider">
          <Sparkles className="size-3 animate-pulse" /> {t("mktAboutUs.badge")}
        </div>
        <h1 className="text-4xl sm:text-6xl font-extrabold text-[var(--m-text-heading)] tracking-tight leading-[1.1]">
          {t("mktAboutUs.titlePrefix")} <span className="bg-gradient-to-r from-emerald-400 to-teal-400 bg-clip-text text-transparent">Whasalia</span>
        </h1>
        <p className="text-sm text-[var(--m-text-tertiary)] max-w-xl mx-auto leading-relaxed mt-4">
          {t("mktAboutUs.subtitle")}
        </p>
      </div>

      {/* Core values block */}
      <div className="space-y-6">
        <div className="text-center space-y-2">
          <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight text-[var(--m-text-heading)]">{t("mktAboutUs.servicesTitle")}</h2>
          <p className="text-xs text-[var(--m-text-tertiary)]">{t("mktAboutUs.servicesSubtitle")}</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pt-6">
          {services.map((service, index) => {
            const Icon = service.icon;
            return (
              <SpotlightCard key={index} glowColor={service.glow} interactive={true}>
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                    <Icon className="size-4 text-emerald-400" />
                  </div>
                  <h4 className="text-sm font-bold text-[var(--m-text-secondary)]">{service.title}</h4>
                </div>
                <p className="text-xs text-[var(--m-text-tertiary)] leading-relaxed">
                  {service.desc}
                </p>
              </SpotlightCard>
            );
          })}
        </div>
      </div>
    </div>
  );
}

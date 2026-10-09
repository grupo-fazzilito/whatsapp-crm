"use client";

import React from "react";
import { Shield, Sparkles, Server, HardDrive, Users, Check } from "lucide-react";
import { SpotlightCard } from "@/components/marketing/spotlight-card";
import { useI18n } from "@/i18n/client";

export default function EnterprisePage() {
  const { t } = useI18n();
  const specs = [
    {
      id: "infra",
      title: t("mktEnterprise.specs.infraTitle"),
      desc: t("mktEnterprise.specs.infraDesc"),
      icon: <Server className="size-5 text-emerald-400" />,
    },
    {
      id: "sso",
      title: t("mktEnterprise.specs.ssoTitle"),
      desc: t("mktEnterprise.specs.ssoDesc"),
      icon: <Shield className="size-5 text-teal-400" />,
    },
    {
      id: "models",
      title: t("mktEnterprise.specs.modelsTitle"),
      desc: t("mktEnterprise.specs.modelsDesc"),
      icon: <Sparkles className="size-5 text-emerald-400" />,
    },
  ];

  return (
    <div className="w-full max-w-6xl mx-auto px-4 md:px-6 py-20 space-y-20">
      {/* Header */}
      <div className="text-center space-y-4 max-w-3xl mx-auto">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-emerald-500/25 bg-[var(--m-badge-bg)] text-emerald-500 text-[10px] font-bold uppercase tracking-wider">
          <Shield className="size-3 animate-pulse" /> {t("mktEnterprise.badge")}
        </div>
        <h1 className="text-4xl sm:text-6xl font-extrabold text-[var(--m-text-heading)] tracking-tight leading-[1.1]">
          {t("mktEnterprise.titleLine1")} <br />
          <span className="bg-gradient-to-r from-emerald-400 to-teal-400 bg-clip-text text-transparent">
            {t("mktEnterprise.titleLine2")}
          </span>
        </h1>
        <p className="text-sm text-[var(--m-text-tertiary)] max-w-xl mx-auto">
          {t("mktEnterprise.subtitle")}
        </p>
      </div>

      {/* Grid of enterprise features */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {specs.map((spec) => (
          <SpotlightCard key={spec.id} interactive={true}>
            <div className="mb-4 w-10 h-10 rounded-xl bg-[var(--m-bg-secondary)] border border-[var(--m-border-glass)] flex items-center justify-center">
              {spec.icon}
            </div>
            <h4 className="text-sm font-bold text-[var(--m-text-secondary)]">{spec.title}</h4>
            <p className="text-xs text-[var(--m-text-tertiary)] mt-2 leading-relaxed">{spec.desc}</p>
          </SpotlightCard>
        ))}
      </div>

      {/* SLA guarantees bar */}
      <div className="rounded-2xl border border-[var(--m-border-primary)] bg-[var(--m-bg-card)] p-8 backdrop-blur-md relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-emerald-950/5 to-teal-950/5 pointer-events-none" />
        <div className="max-w-3xl mx-auto flex flex-col md:flex-row items-center justify-between gap-8 relative z-10">
          <div className="space-y-2">
            <span className="text-[10px] uppercase font-bold text-emerald-400">{t("mktEnterprise.sla.eyebrow")}</span>
            <h3 className="text-xl sm:text-2xl font-extrabold text-[var(--m-text-primary)]">{t("mktEnterprise.sla.title")}</h3>
            <p className="text-xs text-[var(--m-text-tertiary)] max-w-md">
              {t("mktEnterprise.sla.desc")}
            </p>
          </div>
          <div className="flex gap-4 shrink-0">
            <div className="bg-[var(--m-bg-secondary)] border border-[var(--m-border-primary)] px-4 py-3 rounded-xl text-center min-w-[100px]">
              <span className="text-[9px] uppercase font-bold text-[var(--m-text-muted)]">{t("mktEnterprise.sla.uptime")}</span>
              <h4 className="text-lg font-black text-[var(--m-text-primary)] mt-1">99.99%</h4>
            </div>
            <div className="bg-[var(--m-bg-secondary)] border border-[var(--m-border-primary)] px-4 py-3 rounded-xl text-center min-w-[100px]">
              <span className="text-[9px] uppercase font-bold text-[var(--m-text-muted)]">{t("mktEnterprise.sla.support")}</span>
              <h4 className="text-lg font-black text-emerald-400 mt-1">24/7</h4>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

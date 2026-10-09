"use client";

import React from "react";
import { Shield, Check, Lock, FileText, CheckCircle } from "lucide-react";
import { SpotlightCard } from "@/components/marketing/spotlight-card";
import { useI18n } from "@/i18n/client";

export default function SecurityPage() {
  const { t } = useI18n();
  const compliance = [
    {
      id: "gdpr",
      title: t("mktSecurity.items.gdprTitle"),
      desc: t("mktSecurity.items.gdprDesc"),
      icon: <CheckCircle className="size-4 text-emerald-400" />,
    },
    {
      id: "encryption",
      title: t("mktSecurity.items.encryptionTitle"),
      desc: t("mktSecurity.items.encryptionDesc"),
      icon: <Lock className="size-4 text-teal-400" />,
    },
    {
      id: "audit",
      title: t("mktSecurity.items.auditTitle"),
      desc: t("mktSecurity.items.auditDesc"),
      icon: <FileText className="size-4 text-emerald-400" />,
    },
  ];

  return (
    <div className="w-full max-w-6xl mx-auto px-4 md:px-6 py-20 space-y-20">
      {/* Header */}
      <div className="text-center space-y-4 max-w-3xl mx-auto">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-emerald-500/25 bg-[var(--m-badge-bg)] text-emerald-500 text-[10px] font-bold uppercase tracking-wider">
          <Shield className="size-3.5 animate-pulse" /> {t("mktSecurity.badge")}
        </div>
        <h1 className="text-4xl sm:text-6xl font-extrabold text-[var(--m-text-heading)] tracking-tight leading-[1.1]">
          {t("mktSecurity.titleLine1")} <br />
          <span className="bg-gradient-to-r from-emerald-400 to-teal-400 bg-clip-text text-transparent">
            {t("mktSecurity.titleLine2")}
          </span>
        </h1>
        <p className="text-sm text-[var(--m-text-tertiary)] max-w-xl mx-auto">
          {t("mktSecurity.subtitle")}
        </p>
      </div>

      {/* Grid of compliance cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {compliance.map((item) => (
          <SpotlightCard key={item.id}>
            <div className="mb-4 w-10 h-10 rounded-xl bg-[var(--m-bg-secondary)] border border-[var(--m-border-glass)] flex items-center justify-center">
              {item.icon}
            </div>
            <h4 className="text-sm font-bold text-[var(--m-text-secondary)]">{item.title}</h4>
            <p className="text-xs text-[var(--m-text-tertiary)] mt-2 leading-relaxed">{item.desc}</p>
          </SpotlightCard>
        ))}
      </div>

      {/* Security Policies block */}
      <div className="rounded-2xl border border-[var(--m-border-primary)] bg-[var(--m-bg-card)] p-8 backdrop-blur-md relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-emerald-950/5 to-teal-950/5 pointer-events-none" />
        <div className="max-w-2xl mx-auto space-y-6 relative z-10 text-center">
          <h3 className="text-xl sm:text-2xl font-extrabold text-[var(--m-text-primary)]">{t("mktSecurity.whitepaper.title")}</h3>
          <p className="text-xs text-[var(--m-text-tertiary)] leading-relaxed max-w-md mx-auto">
            {t("mktSecurity.whitepaper.desc")}
          </p>
          <div className="pt-2">
            <button className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold px-6 py-3 rounded-xl transition-colors cursor-pointer">
              {t("mktSecurity.whitepaper.cta")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

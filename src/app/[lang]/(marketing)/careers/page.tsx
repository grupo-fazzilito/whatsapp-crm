"use client";

import React, { useState } from "react";
import { Sparkles, MapPin, DollarSign, Send, ArrowRight } from "lucide-react";
import { SpotlightCard } from "@/components/marketing/spotlight-card";
import { useI18n } from "@/i18n/client";

export default function CareersPage() {
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const jobs = [
    {
      role: t("mktCareers.jobs.j1Role"),
      loc: t("mktCareers.jobs.j1Loc"),
      sal: "$120k - $160k",
      desc: t("mktCareers.jobs.j1Desc"),
    },
    {
      role: t("mktCareers.jobs.j2Role"),
      loc: t("mktCareers.jobs.j2Loc"),
      sal: "$160k - $210k",
      desc: t("mktCareers.jobs.j2Desc"),
    },
    {
      role: t("mktCareers.jobs.j3Role"),
      loc: t("mktCareers.jobs.j3Loc"),
      sal: "$110k - $150k",
      desc: t("mktCareers.jobs.j3Desc"),
    },
  ];

  const handleApply = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    setEmail("");
  };

  return (
    <div className="w-full max-w-6xl mx-auto px-4 md:px-6 py-20 space-y-20">
      {/* Header */}
      <div className="text-center space-y-4 max-w-3xl mx-auto">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-emerald-500/25 bg-[var(--m-badge-bg)] text-emerald-500 text-[10px] font-bold uppercase tracking-wider">
          <Sparkles className="size-3 animate-pulse" /> {t("mktCareers.badge")}
        </div>
        <h1 className="text-4xl sm:text-6xl font-extrabold text-[var(--m-text-heading)] tracking-tight leading-[1.1]">
          {t("mktCareers.titleLine1")} <br />
          <span className="bg-gradient-to-r from-emerald-400 to-teal-400 bg-clip-text text-transparent">
            {t("mktCareers.titleHighlight")}
          </span>
        </h1>
        <p className="text-sm text-[var(--m-text-tertiary)] max-w-xl mx-auto">
          {t("mktCareers.subtitle")}
        </p>
      </div>

      {/* Open roles */}
      <div className="space-y-6">
        <span className="text-[10px] uppercase font-bold tracking-widest text-[var(--m-text-muted)] block border-b border-[var(--m-border-primary)] pb-3">
          {t("mktCareers.openPositions")}
        </span>

        <div className="space-y-4">
          {jobs.map((job) => (
            <SpotlightCard key={job.role} interactive={true} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6 p-6">
              <div className="space-y-2">
                <h4 className="text-sm font-bold text-[var(--m-text-primary)]">{job.role}</h4>
                <p className="text-xs text-[var(--m-text-tertiary)] max-w-xl">{job.desc}</p>
                <div className="flex gap-4 pt-1.5 text-[10px] text-[var(--m-text-muted)] font-semibold uppercase tracking-wider">
                  <span className="flex items-center gap-1"><MapPin className="size-3" /> {job.loc}</span>
                  <span className="flex items-center gap-1"><DollarSign className="size-3" /> {job.sal}</span>
                </div>
              </div>
              <button className="bg-[var(--m-bg-secondary)] hover:bg-[var(--m-bg-tertiary)] text-[var(--m-text-secondary)] text-xs font-bold px-4 py-2.5 rounded-lg border border-[var(--m-border-primary)] shrink-0 transition-colors flex items-center gap-1.5 cursor-pointer">
                {t("mktCareers.applyNow")} <ArrowRight className="size-3.5" />
              </button>
            </SpotlightCard>
          ))}
        </div>
      </div>

      {/* Speculative Application */}
      <div className="rounded-2xl border border-[var(--m-border-primary)] bg-[var(--m-bg-card)] p-8 backdrop-blur-md relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-emerald-950/5 to-teal-950/5 pointer-events-none" />
        <div className="max-w-2xl mx-auto text-center space-y-6 relative z-10">
          <h3 className="text-xl sm:text-2xl font-extrabold text-[var(--m-text-primary)]">{t("mktCareers.specTitle")}</h3>
          <p className="text-xs text-[var(--m-text-tertiary)] max-w-md mx-auto leading-relaxed">
            {t("mktCareers.specDesc")}
          </p>

          <form onSubmit={handleApply} className="flex gap-2 max-w-sm mx-auto">
            <input
              type="email"
              placeholder={t("mktCareers.emailPlaceholder")}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="flex-1 bg-[var(--m-input-bg)] border border-[var(--m-input-border)] rounded-lg px-3.5 py-2.5 text-xs text-[var(--m-text-secondary)] focus:outline-none focus:border-emerald-500/50"
            />
            <button
              type="submit"
              className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold px-4 py-2.5 rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer shrink-0"
            >
              {submitted ? t("mktCareers.sent") : <><Send className="size-3.5" /> {t("mktCareers.apply")}</>}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

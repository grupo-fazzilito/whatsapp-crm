"use client";

import React from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { SpotlightCard } from "@/components/marketing/spotlight-card";
import { MagneticButton } from "@/components/marketing/magnetic-button";
import {
  Sparkles,
  Inbox,
  Bot,
  HelpCircle,
  Workflow,
  RefreshCw,
  Megaphone,
  Users,
  ShoppingBag,
  Link2,
  CheckSquare,
  BarChart3,
  Lock,
  ArrowRight,
} from "lucide-react";
import { useI18n, useLocalePath } from "@/i18n/client";

export default function FeaturesPage() {
  const { t } = useI18n();
  const lp = useLocalePath();
  const capabilities = [
    {
      name: t("mktFeatures.caps.inbox.name"),
      desc: t("mktFeatures.caps.inbox.desc"),
      icon: <Inbox className="size-5 text-emerald-400" />
    },
    {
      name: t("mktFeatures.caps.agents.name"),
      desc: t("mktFeatures.caps.agents.desc"),
      icon: <Bot className="size-5 text-teal-400" />
    },
    {
      name: t("mktFeatures.caps.faq.name"),
      desc: t("mktFeatures.caps.faq.desc"),
      icon: <HelpCircle className="size-5 text-emerald-400" />
    },
    {
      name: t("mktFeatures.caps.flows.name"),
      desc: t("mktFeatures.caps.flows.desc"),
      icon: <Workflow className="size-5 text-pink-400" />
    },
    {
      name: t("mktFeatures.caps.automations.name"),
      desc: t("mktFeatures.caps.automations.desc"),
      icon: <RefreshCw className="size-5 text-teal-400" />
    },
    {
      name: t("mktFeatures.caps.broadcasts.name"),
      desc: t("mktFeatures.caps.broadcasts.desc"),
      icon: <Megaphone className="size-5 text-emerald-400" />
    },
    {
      name: t("mktFeatures.caps.crm.name"),
      desc: t("mktFeatures.caps.crm.desc"),
      icon: <Users className="size-5 text-amber-400" />
    },
    {
      name: t("mktFeatures.caps.commerce.name"),
      desc: t("mktFeatures.caps.commerce.desc"),
      icon: <ShoppingBag className="size-5 text-teal-400" />
    },
    {
      name: t("mktFeatures.caps.integrations.name"),
      desc: t("mktFeatures.caps.integrations.desc"),
      icon: <Link2 className="size-5 text-pink-400" />
    },
    {
      name: t("mktFeatures.caps.tasks.name"),
      desc: t("mktFeatures.caps.tasks.desc"),
      icon: <CheckSquare className="size-5 text-amber-400" />
    },
    {
      name: t("mktFeatures.caps.reports.name"),
      desc: t("mktFeatures.caps.reports.desc"),
      icon: <BarChart3 className="size-5 text-emerald-400" />
    },
    {
      name: t("mktFeatures.caps.rbac.name"),
      desc: t("mktFeatures.caps.rbac.desc"),
      icon: <Lock className="size-5 text-teal-400" />
    }
  ];

  const metaIntegrations = [
    {
      title: t("mktFeatures.meta.i1Title"),
      desc: t("mktFeatures.meta.i1Desc"),
      icon: "🔗"
    },
    {
      title: t("mktFeatures.meta.i2Title"),
      desc: t("mktFeatures.meta.i2Desc"),
      icon: "📱"
    },
    {
      title: t("mktFeatures.meta.i3Title"),
      desc: t("mktFeatures.meta.i3Desc"),
      icon: "⚡"
    },
    {
      title: t("mktFeatures.meta.i4Title"),
      desc: t("mktFeatures.meta.i4Desc"),
      icon: "📊"
    }
  ];

  return (
    <div className="w-full flex flex-col overflow-hidden">
      {/* Hero Section */}
      <section className="relative w-full py-20 px-4 md:px-6 max-w-6xl mx-auto space-y-6 text-center">
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-emerald-500/25 bg-[var(--m-badge-bg)] text-emerald-500 text-[10px] font-bold uppercase tracking-wider"
        >
          <Sparkles className="size-3 animate-pulse" /> {t("mktFeatures.badge")}
        </motion.div>
        
        <motion.h1
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.1 }}
          className="text-4xl sm:text-6xl font-extrabold text-[var(--m-text-heading)] tracking-tight leading-[1.1] max-w-3xl mx-auto"
        >
          {t("mktFeatures.titleLine1")} <br />
          <span className="bg-gradient-to-r from-emerald-400 to-teal-400 bg-clip-text text-transparent">
            {t("mktFeatures.titleHighlight")}
          </span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.2 }}
          className="text-xs sm:text-sm md:text-sm max-w-2xl mx-auto text-[var(--m-text-tertiary)] leading-relaxed"
        >
          {t("mktFeatures.subtitle")}
        </motion.p>
      </section>

      {/* Grid of Capabilities */}
      <section className="px-4 md:px-6 max-w-6xl mx-auto pb-24">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {capabilities.map((cap, idx) => (
            <SpotlightCard
              key={cap.name}
              interactive={true}
              glowColor="rgba(16, 185, 129, 0.1)"
            >
              <div className="mb-4 w-10 h-10 rounded-xl bg-[var(--m-bg-secondary)] border border-[var(--m-border-glass)] flex items-center justify-center">
                {cap.icon}
              </div>
              <h4 className="text-sm font-bold text-[var(--m-text-secondary)]">{cap.name}</h4>
              <p className="text-xs text-[var(--m-text-tertiary)] mt-2 leading-relaxed">{cap.desc}</p>
            </SpotlightCard>
          ))}
        </div>
      </section>

      {/* How It Works Section */}
      <section className="py-24 px-4 md:px-6 border-t border-[var(--m-border-primary)] bg-[var(--m-bg-secondary)]/15 max-w-6xl mx-auto space-y-16 relative">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center max-w-3xl mx-auto space-y-4"
        >
          <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight text-[var(--m-text-heading)] transition-colors duration-300">
            {t("mktFeatures.how.title")}
          </h2>
          <p className="text-sm text-[var(--m-text-tertiary)] transition-colors duration-300">
            {t("mktFeatures.how.subtitle")}
          </p>
        </motion.div>

        <div className="relative grid grid-cols-1 md:grid-cols-3 gap-12 md:gap-8">
          {/* Connecting Line */}
          <motion.div
            initial={{ scaleX: 0 }}
            whileInView={{ scaleX: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8, delay: 0.2 }}
            className="absolute top-[20px] left-[20px] w-[calc(66.666%)] h-[1px] bg-emerald-500/20 hidden md:block z-0 origin-left"
          />

          {/* Step 1 */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="relative flex flex-col items-center md:items-start text-center md:text-left z-10 group"
          >
            <div className="w-10 h-10 rounded-lg border border-emerald-500/30 bg-[var(--m-bg-primary)] flex items-center justify-center text-xs font-semibold text-emerald-400 mb-6 shadow-md shadow-emerald-500/5 group-hover:border-emerald-500 group-hover:text-emerald-300 transition-all duration-300">
              01
            </div>
            <div className="max-w-xs space-y-3">
              <h3 className="text-base md:text-lg font-semibold text-[var(--m-text-heading)] leading-snug transition-colors duration-300">
                {t("mktFeatures.how.s1Title")}
              </h3>
              <p className="text-xs md:text-sm text-[var(--m-text-tertiary)] leading-relaxed transition-colors duration-300">
                {t("mktFeatures.how.s1Desc")}
              </p>
            </div>
          </motion.div>

          {/* Step 2 */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="relative flex flex-col items-center md:items-start text-center md:text-left z-10 group"
          >
            <div className="w-10 h-10 rounded-lg border border-emerald-500/30 bg-[var(--m-bg-primary)] flex items-center justify-center text-xs font-semibold text-emerald-400 mb-6 shadow-md shadow-emerald-500/5 group-hover:border-emerald-500 group-hover:text-emerald-300 transition-all duration-300">
              02
            </div>
            <div className="max-w-xs space-y-3">
              <h3 className="text-base md:text-lg font-semibold text-[var(--m-text-heading)] leading-snug transition-colors duration-300">
                {t("mktFeatures.how.s2Title")}
              </h3>
              <p className="text-xs md:text-sm text-[var(--m-text-tertiary)] leading-relaxed transition-colors duration-300">
                {t("mktFeatures.how.s2Desc")}
              </p>
            </div>
          </motion.div>

          {/* Step 3 */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="relative flex flex-col items-center md:items-start text-center md:text-left z-10 group"
          >
            <div className="w-10 h-10 rounded-lg border border-emerald-500/30 bg-[var(--m-bg-primary)] flex items-center justify-center text-xs font-semibold text-emerald-400 mb-6 shadow-md shadow-emerald-500/5 group-hover:border-emerald-500 group-hover:text-emerald-300 transition-all duration-300">
              03
            </div>
            <div className="max-w-xs space-y-3">
              <h3 className="text-base md:text-lg font-semibold text-[var(--m-text-heading)] leading-snug transition-colors duration-300">
                {t("mktFeatures.how.s3Title")}
              </h3>
              <p className="text-xs md:text-sm text-[var(--m-text-tertiary)] leading-relaxed transition-colors duration-300">
                {t("mktFeatures.how.s3Desc")}
              </p>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Meta Business Integration */}
      <section className="py-24 px-4 md:px-6 border-t border-[var(--m-border-primary)] max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-12 items-start relative">
        <div className="lg:col-span-1 space-y-6 lg:sticky lg:top-24">
          <div className="inline-flex items-center gap-1 px-3 py-1 rounded-full border border-emerald-500/25 bg-[var(--m-badge-bg)] text-emerald-500 text-[10px] font-bold uppercase tracking-wider">
            {t("mktFeatures.meta.badge")}
          </div>
          <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight leading-tight text-[var(--m-text-heading)]">
            {t("mktFeatures.meta.title")}
          </h2>
          <div className="space-y-4">
            <h4 className="text-xs uppercase font-bold tracking-widest text-[var(--m-text-muted)]">
              {t("mktFeatures.meta.eyebrow")}
            </h4>
            <p className="text-xs md:text-sm leading-relaxed text-[var(--m-text-tertiary)]">
              {t("mktFeatures.meta.desc")}
            </p>
          </div>
          <div className="pt-2">
            <Link
              href={lp("/pricing")}
              className="inline-flex items-center gap-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 px-6 py-2.5 rounded-xl text-xs font-bold transition-all shadow-[0_0_12px_rgba(16,185,129,0.2)]"
            >
              {t("mktFeatures.meta.viewPricing")} <ArrowRight className="size-3.5" />
            </Link>
          </div>
        </div>

        <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-6">
          {metaIntegrations.map((item) => (
            <SpotlightCard key={item.title} glowColor="rgba(20, 184, 166, 0.1)">
              <div className="text-2xl mb-4">{item.icon}</div>
              <h4 className="text-sm font-bold text-[var(--m-text-secondary)]">{item.title}</h4>
              <p className="text-xs text-[var(--m-text-tertiary)] mt-2 leading-relaxed">{item.desc}</p>
            </SpotlightCard>
          ))}
        </div>
      </section>

      {/* Official API note */}
      <section className="py-12 border-t border-[var(--m-border-primary)] text-center text-xs font-semibold text-[var(--m-text-muted)]">
        {t("mktFeatures.meta.footerBadge")}
      </section>
    </div>
  );
}

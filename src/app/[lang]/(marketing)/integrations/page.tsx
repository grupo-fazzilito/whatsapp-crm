"use client";

import React, { useState } from "react";
import { Layers, Search, Sparkles, ArrowRight, Zap, Check } from "lucide-react";
import { SpotlightCard } from "@/components/marketing/spotlight-card";
import { useI18n } from "@/i18n/client";

export default function IntegrationsPage() {
  const { t } = useI18n();
  const [filter, setFilter] = useState<"all" | "crm" | "ecommerce" | "dev">("all");
  const [search, setSearch] = useState("");

  const integrations = [
    {
      name: t("mktIntegrations.items.shopify.name"),
      category: "ecommerce",
      desc: t("mktIntegrations.items.shopify.desc"),
      logo: "S",
      color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
    },
    {
      name: t("mktIntegrations.items.hubspot.name"),
      category: "crm",
      desc: t("mktIntegrations.items.hubspot.desc"),
      logo: "H",
      color: "text-amber-400 bg-amber-500/10 border-amber-500/20",
    },
    {
      name: t("mktIntegrations.items.zapier.name"),
      category: "crm",
      desc: t("mktIntegrations.items.zapier.desc"),
      logo: "Z",
      color: "text-orange-400 bg-orange-500/10 border-orange-500/20",
    },
    {
      name: t("mktIntegrations.items.webhooks.name"),
      category: "dev",
      desc: t("mktIntegrations.items.webhooks.desc"),
      logo: "W",
      color: "text-teal-400 bg-teal-500/10 border-teal-500/20",
    },
    {
      name: t("mktIntegrations.items.salesforce.name"),
      category: "crm",
      desc: t("mktIntegrations.items.salesforce.desc"),
      logo: "SF",
      color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
    },
    {
      name: t("mktIntegrations.items.slack.name"),
      category: "dev",
      desc: t("mktIntegrations.items.slack.desc"),
      logo: "SL",
      color: "text-red-400 bg-red-500/10 border-red-500/20",
    },
  ];

  const filtered = integrations.filter((item) => {
    const matchesFilter = filter === "all" || item.category === filter;
    const matchesSearch = item.name.toLowerCase().includes(search.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  return (
    <div className="w-full max-w-6xl mx-auto px-4 md:px-6 py-20 space-y-16">
      {/* Header */}
      <div className="text-center space-y-4 max-w-3xl mx-auto">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-emerald-500/25 bg-[var(--m-badge-bg)] text-emerald-500 text-[10px] font-bold uppercase tracking-wider">
          <Sparkles className="size-3 animate-pulse" /> {t("mktIntegrations.badge")}
        </div>
        <h1 className="text-4xl sm:text-6xl font-extrabold text-[var(--m-text-heading)] tracking-tight leading-[1.1]">
          {t("mktIntegrations.titleLine1")} <br />
          <span className="bg-gradient-to-r from-emerald-400 to-teal-400 bg-clip-text text-transparent">
            {t("mktIntegrations.titleHighlight")}
          </span>
        </h1>
        <p className="text-sm text-[var(--m-text-tertiary)] max-w-xl mx-auto">
          {t("mktIntegrations.subtitle")}
        </p>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 border-b border-[var(--m-border-primary)] pb-6">
        {/* Category Toggles */}
        <div className="flex flex-wrap gap-2">
          {[
            { id: "all", label: t("mktIntegrations.filters.all") },
            { id: "ecommerce", label: t("mktIntegrations.filters.ecommerce") },
            { id: "crm", label: t("mktIntegrations.filters.crm") },
            { id: "dev", label: t("mktIntegrations.filters.dev") },
          ].map((tag) => (
            <button
              key={tag.id}
              onClick={() => setFilter(tag.id as any)}
              className={`px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all cursor-pointer ${
                filter === tag.id
                  ? "bg-[var(--m-bg-secondary)] border-emerald-500/30 text-emerald-400 shadow-md"
                  : "bg-[var(--m-bg-card)] border-[var(--m-border-glass)] text-[var(--m-text-muted)] hover:text-[var(--m-text-secondary)]"
              }`}
            >
              {tag.label}
            </button>
          ))}
        </div>

        {/* Search input */}
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-3 top-2.5 size-4 text-[var(--m-text-muted)]" />
          <input
            type="text"
            placeholder={t("mktIntegrations.searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-[var(--m-input-bg)] border border-[var(--m-input-border)] rounded-lg pl-9 pr-4 py-2 text-xs text-[var(--m-text-secondary)] placeholder:text-[var(--m-text-muted)] focus:outline-none focus:border-emerald-500/50"
          />
        </div>
      </div>

      {/* Grid of integrations */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {filtered.map((item) => (
          <SpotlightCard
            key={item.name}
            interactive={true}
            glowColor="rgba(16, 185, 129, 0.1)"
          >
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs border ${item.color}`}>
                  {item.logo}
                </div>
                <span className="text-[9px] bg-[var(--m-bg-secondary)] border border-[var(--m-border-primary)] text-[var(--m-text-tertiary)] px-2 py-0.5 rounded font-mono">
                  {t("mktIntegrations.syncTag")}
                </span>
              </div>
              <div>
                <h4 className="text-sm font-bold text-[var(--m-text-secondary)]">{item.name}</h4>
                <p className="text-xs text-[var(--m-text-tertiary)] mt-2 leading-relaxed min-h-[72px]">{item.desc}</p>
              </div>
              <div className="pt-2 border-t border-[var(--m-border-primary)] flex items-center justify-between text-[11px] font-semibold text-emerald-500 hover:text-emerald-400 cursor-pointer group/link">
                <span>{t("mktIntegrations.connect")}</span>
                <ArrowRight className="size-3.5 group-hover/link:translate-x-0.5 transition-transform" />
              </div>
            </div>
          </SpotlightCard>
        ))}
      </div>
    </div>
  );
}

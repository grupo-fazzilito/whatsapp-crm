"use client";

import React from "react";
import { MessageSquare, Sparkles, Star, Quote } from "lucide-react";
import { SpotlightCard } from "@/components/marketing/spotlight-card";
import { useI18n } from "@/i18n/client";

export default function CustomerStoriesPage() {
  const { t } = useI18n();
  const stories = [
    {
      id: "leadloop",
      company: "LeadLoop Inc",
      domain: t("mktStories.leadloop.domain"),
      metric: t("mktStories.leadloop.metric"),
      desc: t("mktStories.leadloop.desc"),
      quote: t("mktStories.leadloop.quote"),
      author: t("mktStories.leadloop.author"),
    },
    {
      id: "pulse",
      company: t("mktStories.pulse.company"),
      domain: t("mktStories.pulse.domain"),
      metric: t("mktStories.pulse.metric"),
      desc: t("mktStories.pulse.desc"),
      quote: t("mktStories.pulse.quote"),
      author: t("mktStories.pulse.author"),
    },
  ];

  return (
    <div className="w-full max-w-6xl mx-auto px-4 md:px-6 py-20 space-y-20">
      {/* Header */}
      <div className="text-center space-y-4 max-w-3xl mx-auto">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-emerald-500/25 bg-[var(--m-badge-bg)] text-emerald-500 text-[10px] font-bold uppercase tracking-wider">
          <Sparkles className="size-3 animate-pulse" /> {t("mktStories.badge")}
        </div>
        <h1 className="text-4xl sm:text-6xl font-extrabold text-[var(--m-text-heading)] tracking-tight leading-[1.1]">
          {t("mktStories.titleLine1")} <br />
          <span className="bg-gradient-to-r from-emerald-400 to-teal-400 bg-clip-text text-transparent">
            {t("mktStories.titleLine2")}
          </span>
        </h1>
        <p className="text-sm text-[var(--m-text-tertiary)] max-w-xl mx-auto">
          {t("mktStories.subtitle")}
        </p>
      </div>

      {/* Stories list */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {stories.map((story) => (
          <SpotlightCard key={story.id} interactive={true} className="p-8 flex flex-col justify-between min-h-[350px]">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-base font-bold text-[var(--m-text-primary)]">{story.company}</h4>
                  <span className="text-[10px] text-[var(--m-text-muted)]">{story.domain}</span>
                </div>
                <span className="text-xs bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-bold px-2 py-0.5 rounded font-mono">
                  {story.metric}
                </span>
              </div>
              <p className="text-xs text-[var(--m-text-tertiary)] leading-relaxed">{story.desc}</p>
            </div>

            <div className="border-t border-[var(--m-border-primary)] pt-6 mt-6 relative pl-6">
              <Quote className="absolute left-0 top-6 size-4 text-emerald-500/25" />
              <p className="text-xs text-[var(--m-text-secondary)] italic leading-relaxed">
                "{story.quote}"
              </p>
              <span className="block text-[10px] text-[var(--m-text-muted)] font-bold mt-2">
                — {story.author}
              </span>
            </div>
          </SpotlightCard>
        ))}
      </div>
    </div>
  );
}

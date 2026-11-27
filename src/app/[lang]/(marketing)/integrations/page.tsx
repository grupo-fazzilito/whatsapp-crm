"use client";

import Link from "next/link";
import { ArrowRight, CalendarCheck, CalendarClock, Check, Code2, Camera, Globe, MessageCircle, MessagesSquare, Send, ShieldCheck, Sparkles } from "lucide-react";
import { SpotlightCard } from "@/components/marketing/spotlight-card";
import { useI18n, useLocalePath } from "@/i18n/client";

// Real integrations of Whasalia only. Google Calendar leads (Google's
// OAuth review reads this page): what it does, which data it uses and how
// to turn it off.

const ITEMS = [
  { key: "whatsapp", icon: MessageCircle, category: "channels" },
  { key: "instagram", icon: Camera, category: "channels" },
  { key: "messenger", icon: MessagesSquare, category: "channels" },
  { key: "telegram", icon: Send, category: "channels" },
  { key: "webchat", icon: Globe, category: "channels" },
  { key: "calendly", icon: CalendarClock, category: "schedule" },
  { key: "api", icon: Code2, category: "dev" },
] as const;

export default function IntegrationsPage() {
  const { t } = useI18n();
  const lp = useLocalePath();
  const g = (k: string) => t(`mktIntegrations.google.${k}`);

  return (
    <div className="w-full max-w-6xl mx-auto px-4 md:px-6 py-20 space-y-16">
      {/* Header */}
      <div className="text-center space-y-4 max-w-3xl mx-auto">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-emerald-500/25 bg-[var(--m-badge-bg)] text-emerald-500 text-[10px] font-bold uppercase tracking-wider">
          <Sparkles className="size-3" /> {t("mktIntegrations.badge")}
        </div>
        <h1 className="text-4xl sm:text-6xl font-extrabold text-[var(--m-text-heading)] tracking-tight leading-[1.1]">
          {t("mktIntegrations.titleLine1")} <br />
          <span className="bg-gradient-to-r from-emerald-400 to-teal-400 bg-clip-text text-transparent">{t("mktIntegrations.titleHighlight")}</span>
        </h1>
        <p className="text-sm text-[var(--m-text-tertiary)] max-w-xl mx-auto">{t("mktIntegrations.subtitle")}</p>
      </div>

      {/* Google Calendar */}
      <section id="google-calendar" aria-labelledby="gcal-title" className="rounded-2xl border border-emerald-500/25 bg-[var(--m-bg-card)] p-6 sm:p-10">
        <div className="grid gap-8 lg:grid-cols-[1.2fr_1fr] lg:items-start">
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <span className="flex size-11 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400">
                <CalendarCheck className="size-6" aria-hidden />
              </span>
              <div>
                <h2 id="gcal-title" className="text-2xl font-bold text-[var(--m-text-heading)]">Google Calendar</h2>
                <p className="text-xs text-[var(--m-text-muted)]">{g("tag")}</p>
              </div>
            </div>
            <p className="text-sm leading-relaxed text-[var(--m-text-secondary)]">{g("intro")}</p>
            <ul className="space-y-2 text-sm text-[var(--m-text-secondary)]">
              {(["f1", "f2", "f3", "f4"] as const).map((k) => (
                <li key={k} className="flex gap-2">
                  <Check className="mt-0.5 size-4 shrink-0 text-emerald-400" aria-hidden />
                  <span>{g(k)}</span>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-3 pt-2">
              <Link href="/signup" className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-400">
                {g("cta")} <ArrowRight className="size-4" aria-hidden />
              </Link>
              <a href={`${lp("/privacy-policy")}#google-user-data`} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--m-border-primary)] px-4 py-2 text-sm font-semibold text-[var(--m-text-secondary)] hover:text-[var(--m-text-heading)]">
                {g("privacy")}
              </a>
            </div>
          </div>
          <div className="space-y-4 rounded-xl border border-[var(--m-border-primary)] bg-[var(--m-bg-secondary)] p-5 text-sm">
            <h3 className="font-semibold text-[var(--m-text-heading)]">{g("howTitle")}</h3>
            <ol className="list-decimal space-y-1.5 pl-5 text-[var(--m-text-secondary)]">
              <li>{g("h1")}</li>
              <li>{g("h2")}</li>
              <li>{g("h3")}</li>
            </ol>
            <h3 className="flex items-center gap-1.5 pt-2 font-semibold text-[var(--m-text-heading)]">
              <ShieldCheck className="size-4 text-emerald-400" aria-hidden /> {g("dataTitle")}
            </h3>
            <p className="text-[var(--m-text-secondary)]">{g("data")}</p>
          </div>
        </div>
      </section>

      {/* The rest */}
      <section aria-labelledby="others-title" className="space-y-6">
        <h2 id="others-title" className="text-xl font-bold text-[var(--m-text-heading)]">{t("mktIntegrations.othersTitle")}</h2>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <SpotlightCard key={item.key} interactive={false} glowColor="rgba(16, 185, 129, 0.1)">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="flex size-9 items-center justify-center rounded-lg border border-emerald-500/20 bg-emerald-500/10 text-emerald-400">
                      <Icon className="size-4" aria-hidden />
                    </span>
                    <span className="rounded border border-[var(--m-border-primary)] bg-[var(--m-bg-secondary)] px-2 py-0.5 text-[10px] text-[var(--m-text-tertiary)]">
                      {t(`mktIntegrations.categories.${item.category}`)}
                    </span>
                  </div>
                  <h3 className="text-sm font-bold text-[var(--m-text-secondary)]">{t(`mktIntegrations.items.${item.key}.name`)}</h3>
                  <p className="text-xs leading-relaxed text-[var(--m-text-tertiary)]">{t(`mktIntegrations.items.${item.key}.desc`)}</p>
                </div>
              </SpotlightCard>
            );
          })}
        </div>
      </section>
    </div>
  );
}

"use client";

import { notFound } from "next/navigation";
import { History } from "lucide-react";
import { useI18n } from "@/i18n/client";
import { CHANGELOG, type ChangeKind } from "@/lib/changelog/entries";
import { cn } from "@/lib/utils";

const KIND_STYLE: Record<ChangeKind, string> = {
  new: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
  improved: "border-sky-500/30 bg-sky-500/10 text-sky-400",
  fixed: "border-amber-500/30 bg-amber-500/10 text-amber-400",
};

/** Public changelog: every improvement shipped, newest first. */
export default function ChangelogPage() {
  if (!CHANGELOG.length) notFound();
  const { t, locale } = useI18n();
  const lang = locale === "en" ? "en" : "es";
  const fmt = new Intl.DateTimeFormat(lang === "en" ? "en-US" : "es-PE", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

  return (
    <div className="mx-auto w-full max-w-3xl space-y-14 px-4 py-20 md:px-6">
      <div className="space-y-4 text-center">
        <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/25 bg-[var(--m-badge-bg)] px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-500">
          <History className="size-3.5" aria-hidden /> {t("mktChangelog.badge")}
        </div>
        <h1 className="text-4xl font-extrabold leading-[1.1] tracking-tight text-[var(--m-text-heading)] sm:text-5xl">{t("mktChangelog.title")}</h1>
        <p className="mx-auto max-w-xl text-sm text-[var(--m-text-tertiary)]">{t("mktChangelog.subtitle")}</p>
      </div>

      <ol className="relative space-y-10 border-l border-[var(--m-border-primary)] pl-6">
        {CHANGELOG.map((entry, i) => (
          <li key={`${entry.date}-${i}`} className="relative">
            <span className="absolute -left-[31px] top-1.5 size-3 rounded-full border-2 border-emerald-500 bg-[var(--m-bg-primary,#020617)]" aria-hidden />
            <time dateTime={entry.date} className="text-xs font-semibold uppercase tracking-wider text-[var(--m-text-muted)]">
              {fmt.format(new Date(`${entry.date}T12:00:00Z`))}
            </time>
            <h2 className="mt-1 text-lg font-bold text-[var(--m-text-heading)]">{entry.title[lang]}</h2>
            <ul className="mt-3 space-y-2">
              {entry.changes.map((c, k) => (
                <li key={k} className="flex items-start gap-3 text-sm leading-relaxed text-[var(--m-text-secondary)]">
                  <span className={cn("mt-0.5 shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider", KIND_STYLE[c.kind])}>
                    {t(`mktChangelog.kind.${c.kind}`)}
                  </span>
                  <span>{c[lang]}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </div>
  );
}

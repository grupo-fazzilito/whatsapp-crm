"use client";

import type { Deal, PipelineStage } from "@/types";
import { Calendar, Check, X } from "lucide-react";
import { useI18n } from "@/i18n/client";
import { useWorkspace } from "@/hooks/use-workspace";
import { formatMoney, moneyLocale } from "@/lib/workspace/countries";
import { cn } from "@/lib/utils";

interface DealCardProps {
  deal: Deal;
  stage: PipelineStage | null;
  onEdit: (deal: Deal) => void;
  isOverlay?: boolean;
  /** Leaves room top-right for the quick actions rendered over the card. */
  reserveActions?: boolean;
}

function initials(name?: string | null, fallback?: string | null) {
  const source = (name || fallback || "?").trim();
  if (!source) return "?";
  return source.charAt(0).toUpperCase();
}

export function DealCard({ deal, stage, onEdit, isOverlay, reserveActions }: DealCardProps) {
  const { t, locale } = useI18n();
  const { workspace } = useWorkspace();
  const contactLabel = deal.contact?.name || deal.contact?.phone || t("crm.deals.noContact");
  const assigneeLabel = deal.assignee?.full_name || null;
  const money = formatMoney(
    Number(deal.value || 0),
    deal.currency || workspace?.currency || "USD",
    moneyLocale({ locale, country: workspace?.country }),
  );
  const dateFmt = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" });

  return (
    <button
      type="button"
      onClick={(e) => {
        // `onClick` still fires after a non-drag tap because the PointerSensor
        // requires 5px movement before it counts as a drag.
        if (isOverlay) return;
        e.stopPropagation();
        onEdit(deal);
      }}
      aria-label={t("crm.deals.cardLabel", { title: deal.title, value: money })}
      className={cn(
        "group relative w-full cursor-pointer rounded-xl border border-slate-700/50 bg-slate-800/70 py-3 pl-4 pr-3 text-left shadow-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        isOverlay ? "shadow-xl" : "hover:-translate-y-0.5 hover:border-slate-600 hover:bg-slate-800 hover:shadow-lg",
        deal.status === "lost" && "opacity-80",
      )}
    >
      {/* 4px left accent bar using stage color */}
      <span
        aria-hidden
        className="absolute left-0 top-0 h-full w-1 rounded-l-xl"
        style={{ backgroundColor: stage?.color ?? "#94a3b8" }}
      />

      <div className="flex items-start justify-between gap-2">
        <h4 className={cn("flex-1 break-words text-sm font-semibold leading-snug text-white", reserveActions && "pr-14")}>
          {deal.title}
        </h4>
        {deal.status === "won" && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">
            <Check className="h-3 w-3" aria-hidden />
            {t("crm.deals.status.won")}
          </span>
        )}
        {deal.status === "lost" && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold text-red-400">
            <X className="h-3 w-3" aria-hidden />
            {t("crm.deals.status.lost")}
          </span>
        )}
      </div>

      {deal.status === "lost" && deal.lost_reason && (
        <p className="mt-1 text-xs text-red-300/90">
          {t("crm.deals.reasonLabel", { reason: deal.lost_reason })}
        </p>
      )}

      {/* Contact row */}
      <div className="mt-2 flex items-center gap-2">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-700 text-[10px] font-semibold text-slate-200" aria-hidden>
          {initials(deal.contact?.name, deal.contact?.phone)}
        </span>
        <span className="truncate text-xs text-slate-400">{contactLabel}</span>
      </div>

      <div className="mt-2 flex items-center justify-between">
        <span className="text-sm font-bold text-primary">{money}</span>
        {deal.expected_close_date && (
          <span className="flex items-center gap-1 text-[11px] text-slate-400">
            <Calendar className="h-3 w-3" aria-hidden />
            {dateFmt.format(new Date(`${deal.expected_close_date}T00:00:00`))}
          </span>
        )}
      </div>

      {assigneeLabel && (
        <div className="mt-2 flex items-center justify-end">
          <span
            title={assigneeLabel}
            className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary"
          >
            {initials(assigneeLabel)}
          </span>
        </div>
      )}
    </button>
  );
}

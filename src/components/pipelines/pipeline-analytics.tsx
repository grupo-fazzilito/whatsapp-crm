"use client";

import { useMemo } from "react";
import type { Deal, PipelineStage } from "@/types";
import {
  DollarSign,
  TrendingUp,
  Target,
  BarChart3,
  Trophy,
  XCircle,
  Info,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useI18n } from "@/i18n/client";
import { useWorkspace } from "@/hooks/use-workspace";
import { formatMoney, moneyLocale } from "@/lib/workspace/countries";

interface PipelineAnalyticsProps {
  stages: PipelineStage[];
  deals: Deal[];
}


/**
 * Weighted pipeline value: value × per-stage probability.
 * First stage ≈ 10%, stages interpolate up to 90% before the final stage,
 * final stage (Won) = 100%. Lost deals excluded.
 */
function computeStageProbability(
  stage: PipelineStage,
  sortedStages: PipelineStage[],
): number {
  const n = sortedStages.length;
  if (n <= 1) return 1;
  const index = sortedStages.findIndex((s) => s.id === stage.id);
  if (index < 0) return 0;
  if (index === n - 1) return 1;
  const slots = n - 1;
  if (slots <= 1) return 0.1;
  const t = index / (slots - 1);
  return 0.1 + t * (0.9 - 0.1);
}

export function PipelineAnalytics({ stages, deals }: PipelineAnalyticsProps) {
  const { t, locale } = useI18n();
  const { workspace } = useWorkspace();
  const formatCurrency = (value: number) =>
    formatMoney(value, workspace?.currency || "USD", moneyLocale({ locale, country: workspace?.country }));
  const sortedStages = useMemo(
    () => [...stages].sort((a, b) => a.position - b.position),
    [stages],
  );

  const stats = useMemo(() => {
    const active = deals.filter((d) => d.status !== "lost");
    const openDeals = active.filter((d) => d.status !== "won");

    const totalCount = active.length;
    const totalValue = active.reduce((sum, d) => sum + Number(d.value || 0), 0);
    const avgValue = totalCount > 0 ? totalValue / totalCount : 0;

    const stageById = new Map(sortedStages.map((s) => [s.id, s]));
    const weightedValue = openDeals.reduce((sum, d) => {
      const stage = stageById.get(d.stage_id);
      if (!stage) return sum;
      const prob = computeStageProbability(stage, sortedStages);
      return sum + Number(d.value || 0) * prob;
    }, 0);

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    // Closed this month: won_at / lost_at (033); older rows fall back to updated_at.
    const thisMonth = (d: Deal) => {
      const ts = (d.status === "won" ? d.won_at : d.status === "lost" ? d.lost_at : null) ?? d.updated_at ?? d.created_at;
      return ts ? new Date(ts) >= monthStart : false;
    };
    const wonThisMonth = deals.filter(
      (d) => d.status === "won" && thisMonth(d),
    ).length;
    const lostThisMonth = deals.filter(
      (d) => d.status === "lost" && thisMonth(d),
    ).length;

    return {
      totalCount,
      totalValue,
      avgValue,
      weightedValue,
      wonThisMonth,
      lostThisMonth,
    };
  }, [deals, sortedStages]);

  return (
    <TooltipProvider>
      <div className="grid grid-cols-2 gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-4 sm:grid-cols-3 xl:grid-cols-6">
        <Metric
          icon={<BarChart3 className="h-4 w-4 text-slate-400" />}
          label={t("crm.analytics.totalDeals")}
          value={String(stats.totalCount)}
          tooltip={t("crm.analytics.totalDealsTip")}
        />
        <Metric
          icon={<DollarSign className="h-4 w-4 text-primary" />}
          label={t("crm.analytics.pipelineValue")}
          value={formatCurrency(stats.totalValue)}
          tooltip={t("crm.analytics.pipelineValueTip")}
        />
        <Metric
          icon={<Target className="h-4 w-4 text-emerald-400" />}
          label={t("crm.analytics.avgDeal")}
          value={formatCurrency(stats.avgValue)}
          tooltip={t("crm.analytics.avgDealTip")}
        />
        <Metric
          icon={<TrendingUp className="h-4 w-4 text-teal-400" />}
          label={t("crm.analytics.weighted")}
          value={formatCurrency(stats.weightedValue)}
          tooltip={t("crm.analytics.weightedTip")}
        />
        <Metric
          icon={<Trophy className="h-4 w-4 text-primary" />}
          label={t("crm.analytics.wonMonth")}
          value={String(stats.wonThisMonth)}
          tooltip={t("crm.analytics.wonMonthTip")}
        />
        <Metric
          icon={<XCircle className="h-4 w-4 text-red-400" />}
          label={t("crm.analytics.lostMonth")}
          value={String(stats.lostThisMonth)}
          tooltip={t("crm.analytics.lostMonthTip")}
        />
      </div>
    </TooltipProvider>
  );
}

function Metric({
  icon,
  label,
  value,
  tooltip,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tooltip: string;
}) {
  const { t } = useI18n();
  return (
    <div className="rounded-lg bg-slate-800/50 p-3">
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-slate-400">
        {icon}
        <span>{label}</span>
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label={t("crm.analytics.howCalculated", { label })}
                className="ml-auto text-slate-500 hover:text-slate-300 focus:outline-none"
              />
            }
          >
            <Info className="h-3 w-3" />
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs text-left">
            {tooltip}
          </TooltipContent>
        </Tooltip>
      </div>
      <p className="mt-1 text-base font-semibold text-white">{value}</p>
    </div>
  );
}

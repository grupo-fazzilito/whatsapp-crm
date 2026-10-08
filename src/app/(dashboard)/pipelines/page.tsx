"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useWorkspace } from "@/hooks/use-workspace";
import type { Pipeline, PipelineStage, Deal } from "@/types";
import { PipelineBoard } from "@/components/pipelines/pipeline-board";
import { PipelineSettings } from "@/components/pipelines/pipeline-settings";
import { DealForm } from "@/components/pipelines/deal-form";
import { PipelineAnalytics } from "@/components/pipelines/pipeline-analytics";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GitBranch, Plus, ChevronDown, Settings } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/i18n/client";
import { CloseDealDialog, type CloseStatus } from "@/components/crm/close-deal-dialog";
import { cn } from "@/lib/utils";
import { RealEstatePipelineButton } from "@/components/pipelines/real-estate-pipeline-button";

// Spec-defined seed — color per the product spec, names in the UI language.
const SPEC_DEFAULT_STAGES = [
  { key: "newLead", color: "#3b82f6", position: 0 }, // blue
  { key: "qualified", color: "#eab308", position: 1 }, // yellow
  { key: "proposal", color: "#f97316", position: 2 }, // orange
  { key: "negotiation", color: "#8b5cf6", position: 3 }, // purple
  { key: "won", color: "#22c55e", position: 4 }, // green
];

type StatusFilter = "open" | "won" | "lost" | "all";
const STATUS_FILTERS: StatusFilter[] = ["open", "won", "lost", "all"];
const FILTER_KEY = "pipelines:status";

export default function PipelinesPage() {
  const supabase = createClient();
  const { t } = useI18n();

  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [selectedPipelineId, setSelectedPipelineId] = useState<string>("");
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);

  // Dialog / sheet state
  const [newPipelineOpen, setNewPipelineOpen] = useState(false);
  const [newPipelineName, setNewPipelineName] = useState("");
  const [creating, setCreating] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Deal form state is lifted here so both the top-bar "Add Deal" and
  // the per-column "+" trigger the same Sheet.
  const [dealFormOpen, setDealFormOpen] = useState(false);
  const [editingDeal, setEditingDeal] = useState<Deal | null>(null);
  const [defaultStageId, setDefaultStageId] = useState<string>("");

  // Won / lost dialog (reason) + board status filter.
  const [closing, setClosing] = useState<{ deal: Deal; status: CloseStatus } | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("open");
  // Deep link: /pipelines?deal=<id> opens that deal.
  const [deepLinkDealId, setDeepLinkDealId] = useState<string | null>(null);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("deal");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (id) setDeepLinkDealId(id);
    try {
      const saved = window.localStorage.getItem(FILTER_KEY) as StatusFilter | null;
      if (saved && STATUS_FILTERS.includes(saved)) setStatusFilter(saved);
    } catch {
      /* storage blocked */
    }
  }, []);
  const changeFilter = (f: StatusFilter) => {
    setStatusFilter(f);
    try {
      window.localStorage.setItem(FILTER_KEY, f);
    } catch {
      /* storage blocked */
    }
  };

  // Guard against double-seeding (React StrictMode double-effect in dev).
  const seedAttempted = useRef(false);
  // Pipelines are workspace settings: only admins may create the default one.
  const { can } = useWorkspace();
  const canSeed = can("admin");

  const loadPipelines = useCallback(async () => {
    const { data, error } = await supabase
      .from("pipelines")
      .select("*")
      .order("created_at");
    if (error) {
      console.error("Failed to load pipelines:", error.message);
      return [];
    }
    return data ?? [];
  }, [supabase]);

  const loadStages = useCallback(
    async (pipelineId: string) => {
      const { data } = await supabase
        .from("pipeline_stages")
        .select("*")
        .eq("pipeline_id", pipelineId)
        .order("position");
      return data ?? [];
    },
    [supabase],
  );

  const loadDeals = useCallback(
    async (pipelineId: string) => {
      const { data } = await supabase
        .from("deals")
        .select("*, contact:contacts(*), assignee:profiles!deals_assigned_to_fkey(*)")
        .eq("pipeline_id", pipelineId)
        .order("created_at", { ascending: false });
      return (data ?? []) as Deal[];
    },
    [supabase],
  );

  const seedDefaultPipeline = useCallback(async (): Promise<Pipeline | null> => {
    const { data: pipeline, error } = await supabase
      .from("pipelines")
      .insert({ name: t("crm.pipelines.defaultName") })
      .select()
      .single();

    if (error || !pipeline) {
      console.error("Failed to seed pipeline:", error?.message);
      return null;
    }

    const stagesPayload = SPEC_DEFAULT_STAGES.map((s) => ({
      pipeline_id: pipeline.id,
      name: t(`crm.pipelines.defaultStages.${s.key}`),
      color: s.color,
      position: s.position,
    }));
    await supabase.from("pipeline_stages").insert(stagesPayload);

    return pipeline as Pipeline;
  }, [supabase, t]);

  // Initial load + seed-if-empty
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      let list = await loadPipelines();

      if (list.length === 0 && canSeed && !seedAttempted.current) {
        seedAttempted.current = true;
        const seeded = await seedDefaultPipeline();
        if (seeded) list = await loadPipelines();
      }

      if (cancelled) return;
      setPipelines(list);
      if (list.length > 0) {
        setSelectedPipelineId((prev) =>
          prev && list.some((p) => p.id === prev) ? prev : list[0].id,
        );
      } else {
        setSelectedPipelineId("");
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadPipelines, seedDefaultPipeline, canSeed]);

  // Deep link: select the deal's pipeline, then open it once loaded.
  useEffect(() => {
    if (!deepLinkDealId || loading) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("deals")
        .select("pipeline_id, status")
        .eq("id", deepLinkDealId)
        .maybeSingle();
      if (cancelled) return;
      if (!data) {
        setDeepLinkDealId(null);
        return;
      }
      if (data.pipeline_id !== selectedPipelineId) setSelectedPipelineId(data.pipeline_id);
    })();
    return () => {
      cancelled = true;
    };
  }, [deepLinkDealId, loading, selectedPipelineId, supabase]);
  useEffect(() => {
    if (!deepLinkDealId) return;
    const deal = deals.find((d) => d.id === deepLinkDealId);
    if (!deal) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDeepLinkDealId(null);
    setEditingDeal(deal);
    setDefaultStageId(deal.stage_id);
    setDealFormOpen(true);
    if (deal.status && deal.status !== "open") setStatusFilter("all");
  }, [deepLinkDealId, deals]);

  // Load stages + deals whenever selected pipeline changes.
  // Clearing on no-selection is a legitimate sync with URL/prop
  // state; the load completion uses async setters inside promise
  // callbacks (not synchronous in the effect body).
  useEffect(() => {
    if (!selectedPipelineId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStages([]);
       
      setDeals([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const [s, d] = await Promise.all([
        loadStages(selectedPipelineId),
        loadDeals(selectedPipelineId),
      ]);
      if (cancelled) return;
      setStages(s);
      setDeals(d);
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedPipelineId, loadStages, loadDeals]);

  const refreshPipelines = useCallback(async () => {
    const list = await loadPipelines();
    setPipelines(list);
    if (list.length === 0) setSelectedPipelineId("");
    else if (!list.some((p) => p.id === selectedPipelineId))
      setSelectedPipelineId(list[0].id);
  }, [loadPipelines, selectedPipelineId]);

  const refreshStages = useCallback(async () => {
    if (!selectedPipelineId) return;
    setStages(await loadStages(selectedPipelineId));
  }, [loadStages, selectedPipelineId]);

  const refreshDeals = useCallback(async () => {
    if (!selectedPipelineId) return;
    setDeals(await loadDeals(selectedPipelineId));
  }, [loadDeals, selectedPipelineId]);

  const handleDealMoved = useCallback(
    async (dealId: string, newStageId: string) => {
      // Optimistic update — board already animated; just persist.
      setDeals((prev) =>
        prev.map((d) => (d.id === dealId ? { ...d, stage_id: newStageId } : d)),
      );
      const { error } = await supabase
        .from("deals")
        .update({ stage_id: newStageId })
        .eq("id", dealId);
      if (error) {
        toast.error(t("crm.deals.errors.moveFailed"));
        refreshDeals();
      }
    },
    [supabase, refreshDeals, t],
  );

  const handleCloseDeal = useCallback((deal: Deal, status: CloseStatus) => {
    setClosing({ deal, status });
  }, []);

  const handleAddDeal = useCallback(
    (stageId?: string) => {
      setEditingDeal(null);
      setDefaultStageId(stageId ?? stages[0]?.id ?? "");
      setDealFormOpen(true);
    },
    [stages],
  );

  const handleEditDeal = useCallback((deal: Deal) => {
    setEditingDeal(deal);
    setDefaultStageId(deal.stage_id);
    setDealFormOpen(true);
  }, []);

  async function handleCreatePipeline() {
    const name = newPipelineName.trim();
    if (!name) return;
    setCreating(true);

    const { data: pipeline, error } = await supabase
      .from("pipelines")
      .insert({ name })
      .select()
      .single();

    if (error || !pipeline) {
      toast.error(t("crm.pipelines.errors.createFailed"));
      setCreating(false);
      return;
    }

    const stagesPayload = SPEC_DEFAULT_STAGES.map((s) => ({
      pipeline_id: pipeline.id,
      name: t(`crm.pipelines.defaultStages.${s.key}`),
      color: s.color,
      position: s.position,
    }));
    await supabase.from("pipeline_stages").insert(stagesPayload);

    setNewPipelineName("");
    setNewPipelineOpen(false);
    setSelectedPipelineId(pipeline.id);
    await refreshPipelines();
    setCreating(false);
    toast.success(t("crm.pipelines.toast.created"));
  }

  const selectedPipeline = pipelines.find((p) => p.id === selectedPipelineId);
  const boardDeals =
    statusFilter === "all" ? deals : deals.filter((d) => (d.status ?? "open") === statusFilter);
  const statusCounts = deals.reduce<Record<string, number>>((acc, d) => {
    const k = d.status ?? "open";
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="h-8 w-48 animate-pulse rounded bg-slate-800" />
          <div className="h-9 w-28 animate-pulse rounded-lg bg-slate-800" />
        </div>
        <div className="flex gap-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-96 w-72 animate-pulse rounded-xl bg-slate-800/50" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {/* Pipeline selector dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger
              className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white hover:bg-slate-800 transition-colors data-[popup-open]:bg-slate-800"
            >
              <GitBranch className="h-4 w-4 text-primary" />
              <span className="font-semibold">
                {selectedPipeline?.name ?? t("crm.pipelines.select")}
              </span>
              <ChevronDown className="h-4 w-4 text-slate-400" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="w-64 border-slate-700 bg-slate-900 text-slate-200"
            >
              {pipelines.length === 0 && (
                <DropdownMenuItem disabled className="text-slate-500">
                  {t("crm.pipelines.empty.title")}
                </DropdownMenuItem>
              )}
              {pipelines.map((p) => (
                <DropdownMenuItem
                  key={p.id}
                  onClick={() => setSelectedPipelineId(p.id)}
                  className={
                    p.id === selectedPipelineId
                      ? "text-primary"
                      : "text-slate-300"
                  }
                >
                  <GitBranch className="mr-2 h-3.5 w-3.5" />
                  {p.name}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator className="bg-slate-700" />
              {selectedPipeline && (
                <DropdownMenuItem
                  onClick={() => setSettingsOpen(true)}
                  className="text-slate-300"
                >
                  <Settings className="mr-2 h-3.5 w-3.5" />
                  {t("crm.pipelines.manage")}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <RealEstatePipelineButton
            pipelines={pipelines}
            onReady={async (id) => {
              setPipelines(await loadPipelines());
              setSelectedPipelineId(id);
            }}
          />
          <Button
            variant="outline"
            onClick={() => setNewPipelineOpen(true)}
            className="border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800"
          >
            <Plus className="mr-1 h-4 w-4" />
            {t("crm.pipelines.add")}
          </Button>
          <Button
            onClick={() => handleAddDeal()}
            disabled={!selectedPipelineId || stages.length === 0}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="mr-1 h-4 w-4" />
            {t("crm.deals.board.add")}
          </Button>
        </div>
      </div>

      {/* Board */}
      {pipelines.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-700 py-20">
          <GitBranch className="h-12 w-12 text-slate-600" />
          <h3 className="mt-4 text-lg font-medium text-white">
            {t("crm.pipelines.empty.title")}
          </h3>
          <p className="mt-2 text-sm text-slate-400">
            {t("crm.pipelines.empty.description")}
          </p>
          <Button
            onClick={() => setNewPipelineOpen(true)}
            className="mt-4 bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="mr-1 h-4 w-4" />
            {t("crm.pipelines.create")}
          </Button>
        </div>
      ) : (
        <>
          <PipelineAnalytics stages={stages} deals={deals} />
          <div
            role="group"
            aria-label={t("crm.deals.filter.label")}
            className="-mx-1 flex gap-1 overflow-x-auto px-1"
          >
            {STATUS_FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={statusFilter === f}
                onClick={() => changeFilter(f)}
                className={cn(
                  "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  statusFilter === f
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-slate-700 text-slate-400 hover:text-white",
                )}
              >
                {t(`crm.deals.filter.${f}`)}
                <span className="tabular-nums text-xs opacity-80">
                  {f === "all" ? deals.length : statusCounts[f] ?? 0}
                </span>
              </button>
            ))}
          </div>
          <PipelineBoard
            stages={stages}
            deals={boardDeals}
            onDealMoved={handleDealMoved}
            onAddDeal={handleAddDeal}
            onEditDeal={handleEditDeal}
            onCloseDeal={handleCloseDeal}
          />
        </>
      )}

      {/* New Pipeline Dialog */}
      <Dialog open={newPipelineOpen} onOpenChange={setNewPipelineOpen}>
        <DialogContent className="sm:max-w-sm bg-slate-900 border-slate-700">
          <DialogHeader>
            <DialogTitle className="text-white">{t("crm.pipelines.newTitle")}</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <Label htmlFor="new-pipeline-name" className="text-slate-300">{t("crm.pipelines.settings.name")}</Label>
            <Input
              id="new-pipeline-name"
              value={newPipelineName}
              onChange={(e) => setNewPipelineName(e.target.value)}
              placeholder={t("crm.pipelines.namePlaceholder")}
              className="mt-2 bg-slate-800 border-slate-700 text-white"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreatePipeline();
              }}
            />
            <p className="mt-2 text-xs text-slate-400">
              {t("crm.pipelines.defaultStagesHint")}
            </p>
          </div>
          <DialogFooter className="bg-slate-900/50 border-slate-700">
            <Button
              variant="outline"
              onClick={() => setNewPipelineOpen(false)}
              className="border-slate-700 text-slate-300 hover:bg-slate-800"
            >
              {t("crm.common.cancel")}
            </Button>
            <Button
              onClick={handleCreatePipeline}
              disabled={creating || !newPipelineName.trim()}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {creating ? t("crm.common.creating") : t("crm.pipelines.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pipeline Settings */}
      {selectedPipeline && (
        <PipelineSettings
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          pipeline={selectedPipeline}
          stages={stages}
          onPipelinesChanged={refreshPipelines}
          onStagesChanged={refreshStages}
          onCreateNewPipeline={() => {
            setSettingsOpen(false);
            setNewPipelineOpen(true);
          }}
        />
      )}

      {/* Deal Form (Sheet) */}
      <DealForm
        open={dealFormOpen}
        onOpenChange={setDealFormOpen}
        deal={editingDeal}
        pipelineId={selectedPipelineId}
        stages={stages}
        defaultStageId={defaultStageId}
        onSaved={refreshDeals}
        onRequestClose={handleCloseDeal}
      />

      {/* Won / lost (reason) */}
      <CloseDealDialog
        deal={closing?.deal ?? null}
        status={closing?.status ?? null}
        onOpenChange={(o) => !o && setClosing(null)}
        onDone={(updated) => {
          setDeals((prev) => prev.map((d) => (d.id === updated.id ? { ...d, ...updated } : d)));
          setEditingDeal((prev) => (prev && prev.id === updated.id ? { ...prev, ...updated } : prev));
          refreshDeals();
        }}
      />
    </div>
  );
}

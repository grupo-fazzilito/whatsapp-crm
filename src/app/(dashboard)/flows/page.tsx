"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Workflow,
  Plus,
  Trash2,
  Pencil,
  Loader2,
  MessageSquare,
  PlayCircle,
  PauseCircle,
  Archive,
  HelpCircle,
  UserPlus,
  FileText,
  Copy,
  Zap,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import type { Translator } from "@/i18n/translate";

/**
 * Flows list page.
 *
 * Open to every authenticated user. Flows is in soft-GA — the "Beta"
 * chip in the header is the only remaining signal that the surface
 * is new. The previous per-account beta gate was removed in PR #134.
 */

interface FlowRow {
  id: string;
  name: string;
  description: string | null;
  status: "draft" | "active" | "archived";
  trigger_type: "keyword" | "first_inbound_message" | "manual";
  trigger_config: { keywords?: string[] } | Record<string, unknown>;
  execution_count: number;
  last_executed_at: string | null;
  created_at: string;
  updated_at: string;
}

const STATUS_COLORS: Record<FlowRow["status"], string> = {
  draft: "border-slate-700 bg-slate-800 text-slate-300",
  active: "border-emerald-600/40 bg-emerald-500/10 text-emerald-300",
  archived: "border-slate-700 bg-slate-800/50 text-slate-500",
};

interface TemplateSummary {
  slug: string;
  name: string;
  description: string;
  icon: "MessageSquare" | "HelpCircle" | "UserPlus";
  trigger_type: string;
  node_count: number;
}

const TEMPLATE_ICONS = {
  MessageSquare,
  HelpCircle,
  UserPlus,
} as const;

// Built-in templates come from the API in English; show them translated
// when we know the slug, else fall back to what the API sent.
const KNOWN_TEMPLATES = new Set(["welcome_menu", "faq_bot", "lead_capture"]);

function templateText(
  t: Translator,
  tmpl: TemplateSummary,
  field: "name" | "description",
): string {
  return KNOWN_TEMPLATES.has(tmpl.slug)
    ? t(`flows.list.templates.${tmpl.slug}.${field}`)
    : tmpl[field];
}

function nodeCountLabel(t: Translator, count: number): string {
  return count === 1
    ? t("flows.list.nodesOne")
    : t("flows.list.nodesMany", { count });
}

export default function FlowsPage() {
  const router = useRouter();
  const t = useT();
  const [flows, setFlows] = useState<FlowRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [flowsRes, tmplRes] = await Promise.all([
          fetch("/api/flows"),
          fetch("/api/flows/templates"),
        ]);
        if (!flowsRes.ok) {
          throw new Error(`Failed to load flows: ${flowsRes.status}`);
        }
        const flowsJson = (await flowsRes.json()) as { flows: FlowRow[] };
        if (!cancelled) setFlows(flowsJson.flows ?? []);
        // Templates endpoint is forward-looking — if it 404s on an
        // older deployment, gracefully fall through.
        if (tmplRes.ok) {
          const tmplJson = (await tmplRes.json()) as {
            templates: TemplateSummary[];
          };
          if (!cancelled) setTemplates(tmplJson.templates ?? []);
        }
      } catch (err) {
        if (!cancelled) {
          console.error(err);
          toast.error(t("flows.list.loadError"));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [t]);

  async function handleCreate() {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/flows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          trigger_type: "keyword",
          trigger_config: { keywords: [] },
        }),
      });
      if (!res.ok) throw new Error(`Create failed: ${res.status}`);
      const json = (await res.json()) as { flow: FlowRow };
      setCreateOpen(false);
      setNewName("");
      router.push(`/flows/${json.flow.id}`);
    } catch (err) {
      console.error(err);
      toast.error(t("flows.list.createError"));
    } finally {
      setCreating(false);
    }
  }

  async function handleUseTemplate(slug: string) {
    setCreating(true);
    try {
      const res = await fetch("/api/flows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template_slug: slug }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? t("flows.list.cloneError"));
      }
      const json = (await res.json()) as { flow: FlowRow };
      setCreateOpen(false);
      router.push(`/flows/${json.flow.id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("flows.list.cloneError");
      toast.error(msg);
    } finally {
      setCreating(false);
    }
  }

  async function handleDuplicate(flow: FlowRow) {
    try {
      const res = await fetch("/api/flows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: t("flows.list.copyName", { name: flow.name }),
          trigger_type: flow.trigger_type,
          trigger_config: flow.trigger_config,
          duplicate_from: flow.id,
        }),
      });
      if (!res.ok) throw new Error(`Duplicate failed: ${res.status}`);
      const json = (await res.json()) as { flow: FlowRow };
      setFlows((prev) => [json.flow, ...prev]);
      toast.success(t("flows.list.duplicated"));
    } catch (err) {
      console.error(err);
      toast.error(t("flows.list.duplicateError"));
    }
  }

  async function handleDelete(flow: FlowRow) {
    const yes = window.confirm(
      t("flows.list.deleteConfirm", { name: flow.name }),
    );
    if (!yes) return;
    try {
      const res = await fetch(`/api/flows/${flow.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
      setFlows((prev) => prev.filter((f) => f.id !== flow.id));
      toast.success(t("flows.list.deleted"));
    } catch (err) {
      console.error(err);
      toast.error(t("flows.list.deleteError"));
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold text-white">{t("flows.list.title")}</h1>
            <span className="inline-flex items-center rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-300">
              {t("flows.list.beta")}
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-400">
            {t("flows.list.subtitle")}
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          {t("flows.list.newFlow")}
        </Button>
      </header>

      {flows.length === 0 ? (
        <EmptyState
          onCreate={() => setCreateOpen(true)}
          templates={templates}
          onUseTemplate={handleUseTemplate}
          creating={creating}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {flows.map((flow) => (
            <FlowCard
              key={flow.id}
              flow={flow}
              onEdit={() => router.push(`/flows/${flow.id}`)}
              onDelete={() => handleDelete(flow)}
              onDuplicate={() => handleDuplicate(flow)}
            />
          ))}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        {/* `sm:max-w-4xl` not `max-w-4xl` — shadcn's DialogContent has
            `sm:max-w-sm` baked into its default classes. Without the
            sm: prefix our override applies at base only and the
            sm-scoped 384px wins at every real desktop breakpoint. */}
        <DialogContent className="sm:max-w-4xl bg-slate-900 text-slate-100">
          <DialogHeader>
            <DialogTitle>{t("flows.list.createTitle")}</DialogTitle>
            <DialogDescription className="text-slate-400">
              {t("flows.list.createSubtitle")}
            </DialogDescription>
          </DialogHeader>

          {templates.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">
                {t("flows.list.fromTemplate")}
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {templates.map((tmpl) => {
                  const Icon = TEMPLATE_ICONS[tmpl.icon] ?? FileText;
                  return (
                    <button
                      key={tmpl.slug}
                      type="button"
                      onClick={() => handleUseTemplate(tmpl.slug)}
                      disabled={creating}
                      className="flex flex-col gap-2.5 rounded-lg border border-slate-800 bg-slate-950 p-4 text-left transition-colors hover:border-primary/40 hover:bg-slate-800 disabled:opacity-50"
                    >
                      <Icon className="h-5 w-5 text-primary" />
                      <span className="text-sm font-semibold text-white">
                        {templateText(t, tmpl, "name")}
                      </span>
                      <span className="text-xs leading-relaxed text-slate-400">
                        {templateText(t, tmpl, "description")}
                      </span>
                      <span className="mt-auto border-t border-slate-800 pt-2 text-[11px] text-slate-500">
                        {nodeCountLabel(t, tmpl.node_count)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="space-y-2 border-t border-slate-800 pt-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">
              {t("flows.list.orBlank")}
            </p>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t("flows.list.namePlaceholder")}
              className="bg-slate-800"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
              }}
            />
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setCreateOpen(false)}
              disabled={creating}
            >
              {t("flows.list.cancel")}
            </Button>
            <Button onClick={handleCreate} disabled={!newName.trim() || creating}>
              {creating && <Loader2 className="h-4 w-4 animate-spin" />}
              {t("flows.list.createBlank")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EmptyState({
  onCreate,
  templates,
  onUseTemplate,
  creating,
}: {
  onCreate: () => void;
  templates: TemplateSummary[];
  onUseTemplate: (slug: string) => void;
  creating: boolean;
}) {
  const t = useT();
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-700 bg-slate-900/50 px-6 py-12 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-800">
        <Workflow className="h-6 w-6 text-slate-500" />
      </div>
      <h2 className="mt-4 text-base font-medium text-white">
        {t("flows.list.emptyTitle")}
      </h2>
      <p className="mt-1 max-w-md text-sm text-slate-400">
        {t("flows.list.emptyBody")}
      </p>

      {templates.length > 0 && (
        <div className="mt-6 w-full max-w-2xl">
          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-500">
            <Zap className="mr-1 inline h-3 w-3" />
            {t("flows.list.quickStart")}
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {templates.map((tmpl) => {
              const Icon = TEMPLATE_ICONS[tmpl.icon] ?? FileText;
              return (
                <button
                  key={tmpl.slug}
                  type="button"
                  onClick={() => onUseTemplate(tmpl.slug)}
                  disabled={creating}
                  className="flex flex-col items-center gap-2 rounded-lg border border-slate-800 bg-slate-950 p-4 text-center transition-colors hover:border-primary/40 hover:bg-slate-800 disabled:opacity-50"
                >
                  <Icon className="h-5 w-5 text-primary" />
                  <span className="text-xs font-semibold text-white">
                    {templateText(t, tmpl, "name")}
                  </span>
                  <span className="text-[10px] text-slate-500">
                    {nodeCountLabel(t, tmpl.node_count)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="mt-5 flex items-center gap-2">
        <Button onClick={onCreate}>
          <Plus className="h-4 w-4" />
          {t("flows.list.createBlank")}
        </Button>
      </div>
    </div>
  );
}

function FlowCard({
  flow,
  onEdit,
  onDelete,
  onDuplicate,
}: {
  flow: FlowRow;
  onEdit: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
}) {
  const t = useT();
  const triggerSummary = describeTrigger(t, flow);
  const StatusIcon =
    flow.status === "active"
      ? PlayCircle
      : flow.status === "archived"
        ? Archive
        : PauseCircle;
  return (
    <div className="flex flex-col rounded-lg border border-slate-800 bg-slate-900 p-4 transition-colors hover:border-slate-700">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Workflow className="h-4 w-4 shrink-0 text-primary" />
          <h3 className="truncate text-sm font-semibold text-white">
            {flow.name}
          </h3>
        </div>
        <Badge
          variant="outline"
          className={cn(
            "shrink-0 gap-1 text-[10px]",
            STATUS_COLORS[flow.status],
          )}
        >
          <StatusIcon className="h-3 w-3" />
          {t(`flows.status.${flow.status}`)}
        </Badge>
      </div>

      <p className="mt-2 line-clamp-2 text-xs text-slate-400">
        {flow.description || triggerSummary}
      </p>

      <div className="mt-4 flex items-center gap-3 text-[11px] text-slate-500">
        <span className="inline-flex items-center gap-1">
          <MessageSquare className="h-3 w-3" />
          {flow.execution_count === 1
            ? t("flows.list.runsOne")
            : t("flows.list.runsMany", { count: flow.execution_count })}
        </span>
      </div>

      <div className="mt-4 flex items-center justify-end gap-2 border-t border-slate-800 pt-3">
        <Button variant="ghost" size="sm" onClick={onEdit}>
          <Pencil className="h-3.5 w-3.5" />
          {t("flows.list.edit")}
        </Button>
        <Button variant="ghost" size="sm" onClick={onDuplicate} title={t("flows.list.duplicateTitle")}>
          <Copy className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onDelete}
          className="text-red-400 hover:bg-red-500/10 hover:text-red-300"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

function describeTrigger(t: Translator, flow: FlowRow): string {
  if (flow.trigger_type === "keyword") {
    const keywords = Array.isArray(flow.trigger_config.keywords)
      ? (flow.trigger_config.keywords as string[])
      : [];
    if (keywords.length === 0) return t("flows.list.trigger.keywordNone");
    return t("flows.list.trigger.keywords", { keywords: keywords.join(", ") });
  }
  if (flow.trigger_type === "first_inbound_message") {
    return t("flows.list.trigger.firstInbound");
  }
  return t("flows.list.trigger.manual");
}

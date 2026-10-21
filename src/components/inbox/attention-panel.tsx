"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ArrowRightLeft, Bot, Hand, PauseCircle, UserRound, UsersRound } from "lucide-react";
import { useI18n } from "@/i18n/client";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import type { Conversation, Profile } from "@/types";
import type { Team } from "@/lib/inbox/types";
import { patchFromRow, type ConversationPatch } from "./message-thread";
import { TransferDialog } from "./transfer-dialog";
import type { InboxChannel } from "./channel-badge";
import type { InboxAgent } from "./use-inbox-directory";
import type { TeamMemberInfo } from "./use-inbox-extras";

export interface AttentionPanelProps {
  conversation: Conversation;
  channel?: InboxChannel | null;
  agentsById?: Map<string, InboxAgent>;
  members?: Profile[];
  teams?: Team[];
  teamMembers?: TeamMemberInfo[];
  onConversationPatch: (conversationId: string, patch: ConversationPatch) => void;
}

const selectClass =
  "h-8 w-full min-w-0 rounded-md border border-slate-700 bg-slate-800 px-2 text-xs text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60";

/**
 * Who takes care of the conversation, at the top of the contact panel:
 * the assigned person (with transfer), the team, and the AI agent.
 * "Take over" stays in the thread header, where it's always in sight.
 */
export function AttentionPanel({
  conversation,
  channel,
  agentsById = new Map(),
  members = [],
  teams = [],
  teamMembers = [],
  onConversationPatch,
}: AttentionPanelProps) {
  const { t } = useI18n();
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);

  async function patch(body: Record<string, unknown>, ok?: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/conversations/${conversation.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || !payload?.conversation) {
        toast.error(t("inbox.thread.updateFailed", { reason: payload?.error || `HTTP ${res.status}` }));
        return;
      }
      onConversationPatch(conversation.id, patchFromRow(payload.conversation as Conversation));
      if (ok) toast.success(ok);
    } catch (err) {
      toast.error(t("inbox.thread.updateFailed", { reason: err instanceof Error ? err.message : "network error" }));
    } finally {
      setBusy(false);
    }
  }

  const assignedId = conversation.assigned_agent_id ?? "";
  const team = conversation.team_id ? teams.find((x) => x.id === conversation.team_id) : null;
  const conversationAgentId = conversation.ai_agent_id ?? null;
  const channelAgent = channel?.ai_agent_id ? agentsById.get(channel.ai_agent_id) : undefined;
  const effectiveAgent = agentsById.get(conversationAgentId ?? channel?.ai_agent_id ?? "");
  const selectableAgents = [...agentsById.values()].filter((a) => a.enabled !== false);
  const pausedUntil = conversation.ai_paused_until ? new Date(conversation.ai_paused_until) : null;
  const aiPaused = !!pausedUntil && pausedUntil.getTime() > Date.now();
  const waiting = !!conversation.needs_human_since && conversation.status !== "closed";

  return (
    <section aria-labelledby="attention-title" className="grid gap-2.5 rounded-lg border border-slate-800 bg-slate-950/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <h4 id="attention-title" className="text-xs font-medium uppercase tracking-wider text-slate-500">
          {t("inboxpro.attention.title")}
        </h4>
        {waiting && (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-semibold text-slate-950">
            <Hand className="h-3 w-3" aria-hidden="true" />
            {t("inboxpro.attention.badge")}
          </span>
        )}
      </div>

      {/* Assigned person + transfer */}
      <div className="grid gap-1">
        <label htmlFor="attention-assignee" className="flex items-center gap-1.5 text-[11px] text-slate-400">
          <UserRound className="h-3 w-3" aria-hidden="true" />
          {t("inboxpro.attention.assignee")}
        </label>
        <div className="flex gap-1.5">
          <select
            id="attention-assignee"
            className={selectClass}
            disabled={busy}
            value={assignedId}
            onChange={(e) => void patch({ assigned_agent_id: e.target.value || null })}
          >
            <option value="">{t("inboxpro.attention.nobody")}</option>
            {members.map((p) => (
              <option key={p.user_id} value={p.user_id}>
                {(p.full_name || p.email) + (p.user_id === user?.id ? ` ${t("inbox.thread.me")}` : "")}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setTransferOpen(true)}
            className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-slate-700 px-2 text-xs text-slate-200 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <ArrowRightLeft className="h-3.5 w-3.5" aria-hidden="true" />
            {t("inboxpro.header.transfer")}
          </button>
        </div>
        {team && (
          <p className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <UsersRound className="h-3 w-3" aria-hidden="true" />
            {t("inboxpro.attention.team", { team: team.name })}
          </p>
        )}
      </div>

      {/* AI agent */}
      {(effectiveAgent || selectableAgents.length > 0) && (
        <div className="grid gap-1">
          <label htmlFor="attention-ai" className="flex items-center gap-1.5 text-[11px] text-slate-400">
            {aiPaused ? <PauseCircle className="h-3 w-3 text-amber-400" aria-hidden="true" /> : <Bot className="h-3 w-3" aria-hidden="true" />}
            {t("routing.inbox.agentLabel")}
          </label>
          <select
            id="attention-ai"
            className={selectClass}
            disabled={busy}
            value={conversationAgentId ?? ""}
            onChange={(e) => {
              const id = e.target.value || null;
              const name = id ? agentsById.get(id)?.name : null;
              void patch({ ai_agent_id: id }, name ? t("routing.inbox.changed", { name }) : t("routing.inbox.cleared"));
            }}
          >
            <option value="">
              {channelAgent ? t("routing.inbox.noneChannel", { name: channelAgent.name }) : t("routing.inbox.none")}
            </option>
            {selectableAgents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <p className={cn("text-[11px]", aiPaused ? "text-amber-300" : "text-slate-400")}>
            {!effectiveAgent
              ? t("routing.inbox.noAiConfigured")
              : aiPaused && pausedUntil
                ? t("inboxpro.attention.aiPaused", {
                    time: pausedUntil.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
                  })
                : t("inboxpro.attention.aiActive", { name: effectiveAgent.name })}
          </p>
        </div>
      )}

      <TransferDialog
        open={transferOpen}
        onOpenChange={setTransferOpen}
        conversationId={conversation.id}
        members={teamMembers}
        teams={teams}
        currentUserId={user?.id ?? null}
        currentAssigneeId={conversation.assigned_agent_id ?? null}
        onTransferred={(row) => onConversationPatch(row.id, patchFromRow(row))}
      />
    </section>
  );
}

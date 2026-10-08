"use client";

import { format } from "date-fns";
import {
  ArrowRightLeft,
  CheckCircle2,
  Flag,
  RotateCcw,
  Tag as TagIcon,
  UserCheck,
  UserMinus,
} from "lucide-react";
import { useI18n } from "@/i18n/client";
import type { ConversationEvent } from "@/lib/inbox/types";
import { priorityOf } from "@/lib/inbox/priority";

type T = ReturnType<typeof useI18n>["t"];

const ICONS = {
  assigned: UserCheck,
  unassigned: UserMinus,
  transferred: ArrowRightLeft,
  resolved: CheckCircle2,
  reopened: RotateCcw,
  priority: Flag,
  tag_added: TagIcon,
  tag_removed: TagIcon,
} as const;

/** Sentence for a timeline event, e.g. "Ana transfirió a Luis: motivo…". */
export function describeEvent(e: ConversationEvent, t: T, nameOf: (userId: string | null) => string, teamName: (id: string | null) => string): string {
  const actor = e.from_user ? nameOf(e.from_user) : t("inboxpro.events.system");
  const to = nameOf(e.to_user);
  const data = (e.data ?? {}) as Record<string, unknown>;
  let text: string;
  switch (e.type) {
    case "assigned":
      if (data.auto) text = t("inboxpro.events.autoAssigned", { to });
      else if (e.from_user && e.from_user === e.to_user) text = t("inboxpro.events.assignedSelf", { actor });
      else text = t("inboxpro.events.assigned", { actor, to });
      break;
    case "unassigned":
      text = t("inboxpro.events.unassigned", { actor });
      break;
    case "transferred":
      text = e.to_user
        ? e.team_id
          ? t("inboxpro.events.transferredTeamMember", { actor, to, team: teamName(e.team_id) })
          : t("inboxpro.events.transferred", { actor, to })
        : t("inboxpro.events.transferredTeam", { actor, team: teamName(e.team_id) });
      break;
    case "resolved":
      text = t("inboxpro.events.resolved", { actor });
      break;
    case "reopened":
      text = data.by === "customer" ? t("inboxpro.events.reopenedByCustomer") : t("inboxpro.events.reopened", { actor });
      break;
    case "priority":
      text = t("inboxpro.events.priority", { actor, priority: t(`inboxpro.priority.${priorityOf(data.to)}`) });
      break;
    case "tag_added":
      text = t("inboxpro.events.tagAdded", { actor, tag: String(data.tag_name ?? "—") });
      break;
    case "tag_removed":
      text = t("inboxpro.events.tagRemoved", { actor, tag: String(data.tag_name ?? "—") });
      break;
    default:
      text = actor;
  }
  return e.note ? `${text}: ${e.note}` : text;
}

interface EventDividerProps {
  event: ConversationEvent;
  nameOf: (userId: string | null) => string;
  teamName: (id: string | null) => string;
}

/** Small centred divider in the thread for an ownership / state change. */
export function EventDivider({ event, nameOf, teamName }: EventDividerProps) {
  const { t } = useI18n();
  const Icon = ICONS[event.type] ?? ArrowRightLeft;
  const text = describeEvent(event, t, nameOf, teamName);
  const time = format(new Date(event.created_at), "HH:mm");
  return (
    <div className="flex items-center gap-2 py-0.5" role="note" aria-label={`${text} (${time})`}>
      <span className="h-px flex-1 bg-slate-700/60" aria-hidden="true" />
      <span className="inline-flex max-w-[85%] items-center gap-1.5 rounded-full border border-slate-700 bg-slate-900/90 px-2.5 py-0.5 text-[11px] text-slate-300">
        <Icon className="h-3 w-3 shrink-0 text-slate-400" aria-hidden="true" />
        <span className="min-w-0 break-words">{text}</span>
        <span className="shrink-0 text-[10px] text-slate-400" aria-hidden="true">{time}</span>
      </span>
      <span className="h-px flex-1 bg-slate-700/60" aria-hidden="true" />
    </div>
  );
}

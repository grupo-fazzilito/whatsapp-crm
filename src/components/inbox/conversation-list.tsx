"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { Conversation, ConversationStatus, Profile } from "@/types";
import { Search, ChevronDown } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { es as esLocale, enUS } from "date-fns/locale";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useI18n } from "@/i18n/client";
import { ChannelIcon, channelLine, type InboxChannel } from "./channel-badge";
import { initialsOf } from "./use-inbox-directory";

type AssignmentFilter = "all" | "mine" | "unassigned";

interface ConversationListProps {
  activeConversationId: string | null;
  onSelect: (conversation: Conversation) => void;
  conversations: Conversation[];
  onConversationsLoaded: (conversations: Conversation[]) => void;
  /**
   * Increment to force the fetch effect below to refire. The parent
   * bumps this on realtime reconnect / tab visibility → visible so the
   * list catches up on any events sent while the WS was disconnected
   * or the tab was throttled. Optional so existing callers keep working.
   */
  resyncToken?: number;
  channels?: InboxChannel[];
  channelsById?: Map<string, InboxChannel>;
  membersByUserId?: Map<string, Profile>;
  currentUserId?: string | null;
}

const STATUS_COLORS: Record<ConversationStatus, string> = {
  open: "bg-primary",
  pending: "bg-amber-500",
  closed: "bg-slate-500",
};

const STATUS_FILTERS: (ConversationStatus | "all")[] = ["all", "open", "pending", "closed"];
const ASSIGNMENT_FILTERS: AssignmentFilter[] = ["all", "mine", "unassigned"];

const EMPTY_CHANNELS: InboxChannel[] = [];
const EMPTY_CHANNEL_MAP = new Map<string, InboxChannel>();
const EMPTY_MEMBER_MAP = new Map<string, Profile>();

const triggerClass =
  "inline-flex h-7 max-w-full items-center justify-center gap-1 rounded-md px-2 text-xs text-slate-400 hover:bg-slate-800 hover:text-white";

export function ConversationList({
  activeConversationId,
  onSelect,
  conversations,
  onConversationsLoaded,
  resyncToken = 0,
  channels = EMPTY_CHANNELS,
  channelsById = EMPTY_CHANNEL_MAP,
  membersByUserId = EMPTY_MEMBER_MAP,
  currentUserId = null,
}: ConversationListProps) {
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ConversationStatus | "all">("all");
  const [channelFilter, setChannelFilter] = useState<string>("all");
  const [assignmentFilter, setAssignmentFilter] = useState<AssignmentFilter>("all");
  const [loading, setLoading] = useState(true);

  // Keep the latest callback in a ref so the fetch effect below can
  // have a stable, empty-dep identity. Previously the fetch useCallback
  // depended on `onConversationsLoaded`, which depends on the parent's
  // `deepLinkConvId` — so every URL change (including one the parent
  // triggered via router.replace after a click) caused a fresh
  // conversations fetch. That extra refetch was the trigger for the
  // deep-link auto-select running a second time and wiping the active
  // thread's messages.
  // Mutation lives in an effect (not render) per React 19's refs rule;
  // the fetch runs once on mount so it's fine to read the slightly
  // older value — the very next render updates the ref for any
  // subsequent async completion.
  const onConversationsLoadedRef = useRef(onConversationsLoaded);
  useEffect(() => {
    onConversationsLoadedRef.current = onConversationsLoaded;
  });

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    (async () => {
      const { data, error } = await supabase
        .from("conversations")
        .select("*, contact:contacts(*)")
        .order("last_message_at", { ascending: false });

      if (cancelled) return;

      if (error) {
        // Supabase errors have non-enumerable properties — log fields explicitly
        console.error("Failed to fetch conversations:", {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        });
        setLoading(false);
        return;
      }

      onConversationsLoadedRef.current(data ?? []);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
    // `resyncToken` is included so the parent can force a refetch when
    // the realtime channel reconnects or the tab regains focus — catches
    // up on any events sent while the WS was disconnected or throttled.
  }, [resyncToken]);

  const filtered = useMemo(() => {
    let result = conversations;

    if (filter !== "all") {
      result = result.filter((c) => c.status === filter);
    }

    if (channelFilter !== "all") {
      result = result.filter((c) => c.channel_id === channelFilter);
    }

    if (assignmentFilter === "mine") {
      result = result.filter((c) => !!currentUserId && c.assigned_agent_id === currentUserId);
    } else if (assignmentFilter === "unassigned") {
      result = result.filter((c) => !c.assigned_agent_id);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((c) => {
        const name = c.contact?.name?.toLowerCase() ?? "";
        const phone = c.contact?.phone?.toLowerCase() ?? "";
        const lastMsg = c.last_message_text?.toLowerCase() ?? "";
        return name.includes(q) || phone.includes(q) || lastMsg.includes(q);
      });
    }

    return result;
  }, [conversations, filter, channelFilter, assignmentFilter, currentUserId, search]);

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearch(e.target.value);
    },
    []
  );

  const handleSelect = useCallback(
    (conv: Conversation) => {
      onSelect(conv);
    },
    [onSelect]
  );

  const activeChannel = channelFilter === "all" ? null : channelsById.get(channelFilter);

  return (
    // w-full on mobile so the list occupies the whole viewport when it's
    // the single pane showing; fixed 320px on desktop where it shares the
    // row with the thread + contact sidebar.
    <div className="flex h-full w-full flex-col border-r border-slate-800 bg-slate-900 lg:w-80">
      {/* Search + Filters */}
      <div className="space-y-2 border-b border-slate-800 p-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <Input
            value={search}
            onChange={handleSearchChange}
            placeholder={t("inbox.list.searchPlaceholder")}
            aria-label={t("inbox.list.searchPlaceholder")}
            className="border-slate-700 bg-slate-800 pl-9 text-sm text-white placeholder-slate-500 focus:border-primary/50"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1">
          {/* Channel filter */}
          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn(triggerClass, channelFilter !== "all" && "text-white")}
              aria-label={t("inbox.list.channelFilter")}
            >
              {activeChannel && <ChannelIcon type={activeChannel.type} size={14} />}
              <span className="truncate">
                {activeChannel ? channelLine(activeChannel) : t("inbox.list.allChannels")}
              </span>
              <ChevronDown className="h-3 w-3 shrink-0" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="border-slate-700 bg-slate-800">
              <DropdownMenuItem
                onClick={() => setChannelFilter("all")}
                className={cn("text-sm", channelFilter === "all" ? "text-primary" : "text-slate-300")}
              >
                {t("inbox.list.allChannels")}
              </DropdownMenuItem>
              {channels.map((ch) => (
                <DropdownMenuItem
                  key={ch.id}
                  onClick={() => setChannelFilter(ch.id)}
                  className={cn(
                    "gap-2 text-sm",
                    channelFilter === ch.id ? "text-primary" : "text-slate-300",
                  )}
                >
                  <ChannelIcon type={ch.type} size={16} />
                  <span className="truncate">{channelLine(ch)}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Assignment filter */}
          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn(triggerClass, assignmentFilter !== "all" && "text-white")}
              aria-label={t("inbox.list.assignmentFilter")}
            >
              {t(`inbox.list.assignment.${assignmentFilter}`)}
              <ChevronDown className="h-3 w-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="border-slate-700 bg-slate-800">
              {ASSIGNMENT_FILTERS.map((value) => (
                <DropdownMenuItem
                  key={value}
                  onClick={() => setAssignmentFilter(value)}
                  className={cn("text-sm", assignmentFilter === value ? "text-primary" : "text-slate-300")}
                >
                  {t(`inbox.list.assignment.${value}`)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Status filter */}
          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn(triggerClass, filter !== "all" && "text-white")}
              aria-label={t("inbox.list.statusFilter")}
            >
              {filter === "all" ? t("inbox.list.allStatuses") : t(`inbox.status.${filter}`)}
              <ChevronDown className="h-3 w-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="border-slate-700 bg-slate-800">
              {STATUS_FILTERS.map((value) => (
                <DropdownMenuItem
                  key={value}
                  onClick={() => setFilter(value)}
                  className={cn("text-sm", filter === value ? "text-primary" : "text-slate-300")}
                >
                  {value === "all" ? t("inbox.list.allStatuses") : t(`inbox.status.${value}`)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Conversation Items */}
      <ScrollArea className="flex-1">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-sm text-slate-500">{t("inbox.list.empty")}</p>
          </div>
        ) : (
          <div className="flex flex-col">
            {filtered.map((conv) => (
              <ConversationItem
                key={conv.id}
                conversation={conv}
                channel={conv.channel_id ? channelsById.get(conv.channel_id) : undefined}
                assignee={
                  conv.assigned_agent_id ? membersByUserId.get(conv.assigned_agent_id) : undefined
                }
                isActive={conv.id === activeConversationId}
                onSelect={handleSelect}
              />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

interface ConversationItemProps {
  conversation: Conversation;
  channel?: InboxChannel;
  assignee?: Profile;
  isActive: boolean;
  onSelect: (conversation: Conversation) => void;
}

function ConversationItem({
  conversation,
  channel,
  assignee,
  isActive,
  onSelect,
}: ConversationItemProps) {
  const { t, locale } = useI18n();
  const contact = conversation.contact;
  const displayName = contact?.name || contact?.phone || t("inbox.list.unknown");
  const initials = displayName.charAt(0).toUpperCase();

  const handleClick = useCallback(() => {
    onSelect(conversation);
  }, [onSelect, conversation]);

  const timeAgo = conversation.last_message_at
    ? formatDistanceToNow(new Date(conversation.last_message_at), {
        addSuffix: false,
        locale: locale === "es" ? esLocale : enUS,
      })
    : "";

  const channelType = channel?.type ?? "whatsapp";
  const assigneeName = assignee?.full_name || assignee?.email;

  return (
    <button
      onClick={handleClick}
      className={cn(
        "flex w-full items-start gap-3 px-3 py-3 text-left transition-colors hover:bg-slate-800/50",
        isActive && "border-l-2 border-primary bg-slate-800/70"
      )}
    >
      {/* Avatar with channel badge */}
      <div className="relative shrink-0">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-700 text-sm font-medium text-white">
          {contact?.avatar_url ? (
            <img
              src={contact.avatar_url}
              alt={displayName}
              className="h-10 w-10 rounded-full object-cover"
            />
          ) : (
            initials
          )}
        </div>
        <ChannelIcon
          type={channelType}
          size={16}
          className="absolute -bottom-0.5 -right-0.5 ring-2 ring-slate-900"
        />
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-medium text-white">
            {displayName}
          </span>
          <span className="shrink-0 text-[10px] text-slate-500">{timeAgo}</span>
        </div>
        <p className="truncate text-[10px] text-slate-500">{channelLine(channel)}</p>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <p className="truncate text-xs text-slate-400">
            {conversation.last_message_text || t("inbox.list.noMessages")}
          </p>
          <div className="flex shrink-0 items-center gap-1.5">
            {conversation.unread_count > 0 && (
              <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                {conversation.unread_count}
              </span>
            )}
            {conversation.assigned_agent_id && (
              <span
                title={t("inbox.list.assignedTo", { name: assigneeName ?? "—" })}
                className="flex h-4 w-4 items-center justify-center overflow-hidden rounded-full bg-slate-600 text-[8px] font-semibold text-white"
              >
                {assignee?.avatar_url ? (
                  <img src={assignee.avatar_url} alt="" className="h-4 w-4 object-cover" />
                ) : (
                  initialsOf(assigneeName)
                )}
              </span>
            )}
            <span
              className={cn(
                "h-2 w-2 rounded-full",
                STATUS_COLORS[conversation.status]
              )}
              title={t(`inbox.status.${conversation.status}`)}
            />
          </div>
        </div>
      </div>
    </button>
  );
}

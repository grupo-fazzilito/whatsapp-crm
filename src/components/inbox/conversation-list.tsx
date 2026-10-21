"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import type { Conversation, ConversationStatus, Profile, Tag } from "@/types";
import { Search, ChevronDown, ArrowUpDown, Tag as TagIcon, Flag, Hand, X } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { es as esLocale, enUS } from "date-fns/locale";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useI18n } from "@/i18n/client";
import {
  DEFAULT_FILTERS,
  INBOX_VIEWS,
  SORT_MODES,
  filterAndSort,
  matchesFilters,
  type ConversationFilters,
  type InboxView,
  type OpenStatusFilter,
  type SortMode,
} from "@/lib/inbox/filters";
import { PRIORITY_ORDER } from "@/lib/inbox/priority";
import type { Priority } from "@/lib/inbox/types";
import { ChannelIcon, channelLine, type InboxChannel } from "./channel-badge";
import { initialsOf } from "./use-inbox-directory";
import { PriorityIndicator, PRIORITY_STYLE } from "./priority";
import { TagChip } from "./tag-chip";

/**
 * Shape of every conversation row the inbox holds (list + hydrate), as the
 * old PostgREST select. GET /api/inbox/conversations[?id=] returns rows in
 * exactly this shape; kept for callers that still reference it.
 */
export const CONVERSATION_LIST_SELECT =
  "*, contact:contacts(*, contact_tags(tag_id)), conversation_tags(id, tag_id)";

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
  tags?: Tag[];
  tagsById?: Map<string, Tag>;
}

const STATUS_COLORS: Record<ConversationStatus, string> = {
  open: "bg-primary",
  pending: "bg-amber-500",
  closed: "bg-emerald-500",
};

const OPEN_STATUS_FILTERS: OpenStatusFilter[] = ["all", "open", "pending"];

const EMPTY_CHANNELS: InboxChannel[] = [];
const EMPTY_CHANNEL_MAP = new Map<string, InboxChannel>();
const EMPTY_MEMBER_MAP = new Map<string, Profile>();
const EMPTY_TAGS: Tag[] = [];
const EMPTY_TAG_MAP = new Map<string, Tag>();

const STORAGE_KEY = "inbox:list-prefs:v1";

interface StoredPrefs {
  view?: InboxView;
  sort?: SortMode;
  tagIds?: string[];
  includeContactTags?: boolean;
  priorities?: Priority[];
}

function readPrefs(): StoredPrefs {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null;
    return raw ? (JSON.parse(raw) as StoredPrefs) : {};
  } catch {
    return {};
  }
}

const triggerClass =
  "inline-flex h-7 max-w-full items-center justify-center gap-1 rounded-md px-2 text-xs text-slate-300 hover:bg-slate-800 hover:text-white";

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
  tags = EMPTY_TAGS,
  tagsById = EMPTY_TAG_MAP,
}: ConversationListProps) {
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const [prefs] = useState(readPrefs);
  // ?view=attention (sidebar "Atención requerida") wins over the saved view,
  // also when the link is followed while the inbox is already open.
  const viewParam = useSearchParams().get("view");
  const isView = (v: unknown): v is InboxView => typeof v === "string" && (INBOX_VIEWS as readonly string[]).includes(v);
  const [view, setView] = useState<InboxView>(isView(viewParam) ? viewParam : isView(prefs.view) ? prefs.view : "all");
  const [seenViewParam, setSeenViewParam] = useState(viewParam);
  if (viewParam !== seenViewParam) {
    setSeenViewParam(viewParam);
    if (isView(viewParam)) setView(viewParam);
  }
  const [status, setStatus] = useState<OpenStatusFilter>("all");
  const [channelFilter, setChannelFilter] = useState<string>("all");
  const [tagIds, setTagIds] = useState<string[]>(Array.isArray(prefs.tagIds) ? prefs.tagIds : []);
  const [includeContactTags, setIncludeContactTags] = useState(prefs.includeContactTags === true);
  const [priorities, setPriorities] = useState<Priority[]>(Array.isArray(prefs.priorities) ? prefs.priorities : []);
  const [sort, setSort] = useState<SortMode>(
    prefs.sort && (SORT_MODES as readonly string[]).includes(prefs.sort) ? prefs.sort : "recent",
  );
  const [loading, setLoading] = useState(true);

  // Remember the view / sort / tag / priority choices for this browser.
  useEffect(() => {
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ view, sort, tagIds, includeContactTags, priorities } satisfies StoredPrefs),
      );
    } catch {
      // storage unavailable (private mode) — preferences just don't persist
    }
  }, [view, sort, tagIds, includeContactTags, priorities]);

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
    let cancelled = false;

    (async () => {
      let data: Conversation[] | null = null;
      try {
        const res = await fetch("/api/inbox/conversations", { cache: "no-store" });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
        data = (body.conversations ?? []) as Conversation[];
      } catch (error) {
        if (cancelled) return;
        console.error("Failed to fetch conversations:", error instanceof Error ? error.message : error);
        setLoading(false);
        return;
      }

      if (cancelled) return;

      onConversationsLoadedRef.current(data);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
    // `resyncToken` is included so the parent can force a refetch when
    // the realtime channel reconnects or the tab regains focus — catches
    // up on any events sent while the WS was disconnected or throttled.
  }, [resyncToken]);

  // Ignore stored tag ids that no longer exist.
  const validTagIds = useMemo(
    () => (tags.length ? tagIds.filter((id) => tagsById.has(id)) : tagIds),
    [tagIds, tags.length, tagsById],
  );

  const filters: ConversationFilters = useMemo(
    () => ({
      ...DEFAULT_FILTERS,
      view,
      status,
      channelId: channelFilter === "all" ? null : channelFilter,
      tagIds: validTagIds,
      includeContactTags,
      priorities,
      search,
      currentUserId,
    }),
    [view, status, channelFilter, validTagIds, includeContactTags, priorities, search, currentUserId],
  );

  const filtered = useMemo(() => filterAndSort(conversations, filters, sort), [conversations, filters, sort]);

  // Per-view counts with the other filters applied (shown on the tabs).
  const viewCounts = useMemo(() => {
    const counts = {} as Record<InboxView, number>;
    for (const v of INBOX_VIEWS) {
      const f = { ...filters, view: v, status: v === "resolved" ? "all" : filters.status } as ConversationFilters;
      counts[v] = conversations.reduce((n, c) => (matchesFilters(c, f) ? n + 1 : n), 0);
    }
    return counts;
  }, [conversations, filters]);

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
  const hasExtraFilters =
    channelFilter !== "all" || status !== "all" || validTagIds.length > 0 || priorities.length > 0;
  const clearFilters = () => {
    setChannelFilter("all");
    setStatus("all");
    setTagIds([]);
    setPriorities([]);
  };

  const toggleIn = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  return (
    // w-full on mobile so the list occupies the whole viewport when it's
    // the single pane showing; fixed 320px on desktop where it shares the
    // row with the thread + contact sidebar.
    <div className="flex h-full w-full flex-col border-r border-slate-800 bg-slate-900 lg:w-80">
      {/* Search + Filters */}
      <div className="space-y-2 border-b border-slate-800 p-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden="true" />
          <Input
            value={search}
            onChange={handleSearchChange}
            placeholder={t("inbox.list.searchPlaceholder")}
            aria-label={t("inbox.list.searchPlaceholder")}
            className="border-slate-700 bg-slate-800 pl-9 text-sm text-white placeholder-slate-500 focus:border-primary/50"
          />
        </div>

        {/* Views: Todas / Atención / Mías / Sin asignar / Resueltas */}
        <div role="tablist" aria-label={t("inboxpro.views.label")} className="grid grid-cols-5 gap-0.5 rounded-lg bg-slate-800 p-0.5">
          {INBOX_VIEWS.map((v) => {
            const active = view === v;
            return (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setView(v)}
                className={cn(
                  "flex min-w-0 flex-col items-center rounded-md px-1 py-1 text-[11px] leading-tight transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                  active ? "bg-slate-950 text-white shadow-sm" : "text-slate-400 hover:text-white",
                )}
              >
                <span className="max-w-full truncate">{t(`inboxpro.views.${v}`)}</span>
                <span
                  className={cn(
                    "text-[10px]",
                    v === "attention" && viewCounts[v] > 0
                      ? "rounded-full bg-amber-500 px-1.5 font-semibold text-slate-950"
                      : active
                        ? "text-primary"
                        : "text-slate-400",
                  )}
                >
                  {viewCounts[v]}
                </span>
              </button>
            );
          })}
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

          {/* Status filter (open views only) */}
          {view !== "resolved" && (
            <DropdownMenu>
              <DropdownMenuTrigger
                className={cn(triggerClass, status !== "all" && "text-white")}
                aria-label={t("inbox.list.statusFilter")}
              >
                {status === "all" ? t("inboxpro.filters.allStatuses") : t(`inboxpro.status.${status}`)}
                <ChevronDown className="h-3 w-3" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="border-slate-700 bg-slate-800">
                {OPEN_STATUS_FILTERS.map((value) => (
                  <DropdownMenuItem
                    key={value}
                    onClick={() => setStatus(value)}
                    className={cn("text-sm", status === value ? "text-primary" : "text-slate-300")}
                  >
                    {value === "all" ? t("inboxpro.filters.allStatuses") : t(`inboxpro.status.${value}`)}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* Tag filter */}
          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn(triggerClass, validTagIds.length > 0 && "text-white")}
              aria-label={t("inboxpro.filters.tags")}
            >
              <TagIcon className="h-3 w-3" aria-hidden="true" />
              {validTagIds.length ? t("inboxpro.filters.tagsCount", { n: validTagIds.length }) : t("inboxpro.filters.tags")}
              <ChevronDown className="h-3 w-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-80 w-60 border-slate-700 bg-slate-800">
              {tags.length === 0 ? (
                <DropdownMenuItem disabled className="text-sm text-slate-400">
                  {t("inboxpro.filters.noTags")}
                </DropdownMenuItem>
              ) : (
                tags.map((tag) => (
                  <DropdownMenuCheckboxItem
                    key={tag.id}
                    checked={validTagIds.includes(tag.id)}
                    onCheckedChange={() => setTagIds((prev) => toggleIn(prev, tag.id))}
                    closeOnClick={false}
                    className="gap-2 text-sm text-slate-200"
                  >
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: tag.color }} aria-hidden="true" />
                    <span className="truncate">{tag.name}</span>
                  </DropdownMenuCheckboxItem>
                ))
              )}
              <DropdownMenuSeparator className="bg-slate-700" />
              <DropdownMenuCheckboxItem
                checked={includeContactTags}
                onCheckedChange={(v) => setIncludeContactTags(v === true)}
                closeOnClick={false}
                className="text-sm text-slate-200"
              >
                {t("inboxpro.filters.includeContactTags")}
              </DropdownMenuCheckboxItem>
              {validTagIds.length > 0 && (
                <DropdownMenuItem onClick={() => setTagIds([])} className="text-sm text-slate-400">
                  {t("inboxpro.filters.clearTags")}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Priority filter */}
          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn(triggerClass, priorities.length > 0 && "text-white")}
              aria-label={t("inboxpro.filters.priority")}
            >
              <Flag className="h-3 w-3" aria-hidden="true" />
              {priorities.length === 1
                ? t(`inboxpro.priority.${priorities[0]}`)
                : priorities.length > 1
                  ? t("inboxpro.filters.priorityCount", { n: priorities.length })
                  : t("inboxpro.filters.priority")}
              <ChevronDown className="h-3 w-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48 border-slate-700 bg-slate-800">
              {PRIORITY_ORDER.map((p) => {
                const s = PRIORITY_STYLE[p];
                return (
                  <DropdownMenuCheckboxItem
                    key={p}
                    checked={priorities.includes(p)}
                    onCheckedChange={() => setPriorities((prev) => toggleIn(prev, p))}
                    closeOnClick={false}
                    className="gap-2 text-sm text-slate-200"
                  >
                    <s.Icon className={cn("h-3.5 w-3.5", s.className)} aria-hidden="true" />
                    {t(`inboxpro.priority.${p}`)}
                  </DropdownMenuCheckboxItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Sort */}
          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn(triggerClass, sort !== "recent" && "text-white")}
              aria-label={`${t("inboxpro.filters.sort")}: ${t(`inboxpro.sort.${sort}`)}`}
              title={`${t("inboxpro.filters.sort")}: ${t(`inboxpro.sort.${sort}`)}`}
            >
              <ArrowUpDown className="h-3 w-3" aria-hidden="true" />
              <span className="sr-only">{t("inboxpro.filters.sort")}</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60 border-slate-700 bg-slate-800">
              <DropdownMenuRadioGroup value={sort} onValueChange={(v) => setSort(v as SortMode)}>
                {SORT_MODES.map((m) => (
                  <DropdownMenuRadioItem key={m} value={m} className="text-sm text-slate-200">
                    {t(`inboxpro.sort.${m}`)}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          {hasExtraFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-slate-400 hover:bg-slate-800 hover:text-white"
            >
              <X className="h-3 w-3" aria-hidden="true" />
              {t("inboxpro.filters.clear")}
            </button>
          )}
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
            <p className="text-sm text-slate-400">{t("inbox.list.empty")}</p>
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
                tagsById={tagsById}
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
  tagsById: Map<string, Tag>;
  isActive: boolean;
  onSelect: (conversation: Conversation) => void;
}

const MAX_CHIPS = 2;

function ConversationItem({
  conversation,
  channel,
  assignee,
  tagsById,
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
  const chipTags = (conversation.conversation_tags ?? [])
    .map((l) => tagsById.get(l.tag_id))
    .filter((tg): tg is Tag => !!tg);

  return (
    <button
      onClick={handleClick}
      aria-current={isActive ? "true" : undefined}
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
          <span className="flex min-w-0 items-center gap-1.5">
            <PriorityIndicator priority={conversation.priority} />
            <span className="truncate text-sm font-medium text-white">{displayName}</span>
          </span>
          <span className="shrink-0 text-[10px] text-slate-400">{timeAgo}</span>
        </div>
        <p className="truncate text-[10px] text-slate-400">{channelLine(channel)}</p>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <p className="truncate text-xs text-slate-400">
            {conversation.last_message_text || t("inbox.list.noMessages")}
          </p>
          <div className="flex shrink-0 items-center gap-1.5">
            {conversation.needs_human_since && conversation.status !== "closed" && (
              <span
                title={t("inboxpro.attention.row")}
                aria-label={t("inboxpro.attention.row")}
                className="flex h-4 w-4 items-center justify-center rounded-full bg-amber-500 text-slate-950"
              >
                <Hand className="h-2.5 w-2.5" aria-hidden="true" />
              </span>
            )}
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
              title={t(`inboxpro.status.${conversation.status}`)}
            />
            <span className="sr-only">{t(`inboxpro.status.${conversation.status}`)}</span>
          </div>
        </div>
        {chipTags.length > 0 && (
          <div className="mt-1 flex min-w-0 items-center gap-1 overflow-hidden">
            {chipTags.slice(0, MAX_CHIPS).map((tg) => (
              <TagChip key={tg.id} name={tg.name} color={tg.color} size="xs" className="max-w-[45%]" />
            ))}
            {chipTags.length > MAX_CHIPS && (
              <span
                className="shrink-0 text-[10px] text-slate-400"
                title={chipTags.slice(MAX_CHIPS).map((tg) => tg.name).join(", ")}
              >
                {t("inboxpro.tags.more", { n: chipTags.length - MAX_CHIPS })}
              </span>
            )}
          </div>
        )}
      </div>
    </button>
  );
}

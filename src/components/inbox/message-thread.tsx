"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useWorkspace } from "@/hooks/use-workspace";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/utils";
import type {
  Conversation,
  Message,
  MessageReaction,
  Contact,
  ConversationStatus,
  MessageTemplate,
  Profile,
} from "@/types";
import {
  MessageSquare,
  ChevronDown,
  UserPlus,
  Check,
  Clock,
  ArrowLeft,
  RefreshCw,
  Sparkles,
  Bot,
  Hand,
  PauseCircle,
  CheckCircle2,
  RotateCcw,
  ArrowRightLeft,
  MessagesSquare,
  Paperclip,
  NotebookText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { format, isToday, isYesterday, differenceInMinutes } from "date-fns";
import { es as esLocale, enUS } from "date-fns/locale";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { channelCapabilities, attachmentKind } from "@/lib/channels/capabilities";
import { MessageBubble } from "./message-bubble";
import { SummarySheet } from "./ai-assist/summary-sheet";
import { MessageActions } from "./message-actions";
import { MessageComposer } from "./message-composer";
import { TemplatePicker } from "./template-picker";
import { buildReplyPreview } from "./reply-quote";
import { ChannelBadge, type InboxChannel } from "./channel-badge";
import type { InboxAgent } from "./use-inbox-directory";
import { toast } from "sonner";
import type { Tag } from "@/types";
import type { ConversationEvent, Priority, QuickReply, QuickReplyAttachment, Team } from "@/lib/inbox/types";
import { formatToday } from "@/lib/inbox/quick-replies";
import type { MentionCandidate } from "@/lib/inbox/mentions";
import { NoteBubble } from "./note-bubble";
import { EventDivider } from "./event-divider";
import { PriorityPicker } from "./priority";
import { ConversationTags, type ConversationTagLink } from "./conversation-tags";
import { ConversationFiles } from "./conversation-files";
import { TransferDialog } from "./transfer-dialog";
import type { TeamMemberInfo } from "./use-inbox-extras";

interface ReplyDraft {
  id: string;
  authorLabel: string;
  preview: string;
}

function renderTemplateBody(body: string, params: string[]): string {
  return body.replace(/\{\{(\d+)\}\}/g, (_, raw) => {
    const idx = Number(raw) - 1;
    return params[idx] ?? `{{${raw}}}`;
  });
}

/** Fields the thread may change on a conversation (server-confirmed rows). */
export type ConversationPatch = Partial<
  Pick<
    Conversation,
    | "status"
    | "assigned_agent_id"
    | "ai_paused_until"
    | "updated_at"
    | "priority"
    | "resolved_at"
    | "resolved_by"
    | "team_id"
    | "conversation_tags"
  >
> & {
  /** AI agent owning the conversation (overrides the channel's). */
  ai_agent_id?: string | null;
};

/** Patch with only the columns a PATCH/transfer response row carries. */
function patchFromRow(row: Conversation): ConversationPatch {
  return {
    status: row.status,
    assigned_agent_id: row.assigned_agent_id ?? undefined,
    ai_paused_until: row.ai_paused_until ?? null,
    ai_agent_id: row.ai_agent_id ?? null,
    updated_at: row.updated_at,
    priority: row.priority,
    resolved_at: row.resolved_at ?? null,
    resolved_by: row.resolved_by ?? null,
    team_id: row.team_id ?? null,
  };
}

type TimelineItem =
  | { kind: "message"; at: string; message: Message }
  | { kind: "event"; at: string; event: ConversationEvent };

interface MessageThreadProps {
  conversation: Conversation | null;
  contact: Contact | null;
  messages: Message[];
  onMessagesLoaded: (messages: Message[]) => void;
  onNewMessage: (message: Message) => void;
  onUpdateMessage: (id: string, updates: Partial<Message>) => void;
  /** Drop a message from local state (retry of a failed send). */
  onRemoveMessage?: (id: string) => void;
  /** Apply a server-confirmed change to the conversation in the parent's state. */
  onConversationPatch: (conversationId: string, patch: ConversationPatch) => void;
  /** Channel of the conversation (null while loading / legacy rows). */
  channel?: InboxChannel | null;
  /** AI agents by id, for bot-message attribution and the AI control. */
  agentsById?: Map<string, InboxAgent>;
  /** Active workspace members (assignable). */
  members?: Profile[];
  /**
   * On mobile, the thread is shown full-screen with the conversation list
   * hidden. This callback lets the page deselect the active conversation
   * and reveal the list again. Rendered as a back-arrow in the header on
   * mobile only.
   */
  onBack?: () => void;
  /**
   * Increment to force the messages + reactions fetch effects to refire.
   * Parent bumps this on realtime reconnect / tab visibility → visible
   * so the open thread catches up on any events sent while the WS was
   * disconnected or the tab was throttled. Optional so existing callers
   * keep working.
   */
  resyncToken?: number;
  /**
   * Fired by the manual-refresh button in the thread header. The parent
   * typically bumps the same `resyncToken` it controls — this gives the
   * user a way to force a refetch when they suspect realtime missed an
   * event (or they're impatient). Optional so existing callers keep
   * working; the button is only rendered when this is provided.
   */
  onRefresh?: () => void;
  /** Workspace tags (for the tag popover). */
  tags?: Tag[];
  tagsById?: Map<string, Tag>;
  onTagCreated?: (tag: Tag) => void;
  teams?: Team[];
  /** Members with availability (transfer dialog). */
  teamMembers?: TeamMemberInfo[];
  quickReplies?: QuickReply[];
}

function groupByDate(items: TimelineItem[]) {
  const groups: { date: string; items: TimelineItem[] }[] = [];
  let currentDate = "";

  for (const item of items) {
    const day = format(new Date(item.at), "yyyy-MM-dd");
    if (day !== currentDate) {
      currentDate = day;
      groups.push({ date: item.at, items: [item] });
    } else {
      groups[groups.length - 1].items.push(item);
    }
  }

  return groups;
}

const STATUS_OPTIONS: { value: ConversationStatus; color: string }[] = [
  { value: "open", color: "text-primary" },
  { value: "pending", color: "text-amber-400" },
  { value: "closed", color: "text-emerald-400" },
];

const EMPTY_AGENTS = new Map<string, InboxAgent>();
const EMPTY_MEMBERS: Profile[] = [];
const EMPTY_TAGS: Tag[] = [];
const EMPTY_TAG_MAP = new Map<string, Tag>();
const EMPTY_TEAMS: Team[] = [];
const EMPTY_TEAM_MEMBERS: TeamMemberInfo[] = [];
const EMPTY_QR: QuickReply[] = [];
const EMPTY_LINKS: ConversationTagLink[] = [];

/**
 * WhatsApp-style doodle background applied to the chat area (both the
 * active thread and the empty state). The SVG tile lives at
 * `/public/inbox-doodle.svg`; the slate-950 colour sits underneath so
 * the doodles read as a subtle pattern rather than a stark grid.
 *
 * Defined once at module scope so the two render paths can't drift —
 * if we ever switch the asset, both spots update together.
 */
const DOODLE_BG_CLASSES =
  "bg-slate-950 inbox-doodle-bg bg-repeat";

function safeFileName(name: string): string {
  const cleaned = name.normalize("NFKD").replace(/[^\w.\-]+/g, "_").replace(/_+/g, "_");
  return cleaned.slice(-80) || "file";
}

export function MessageThread({
  conversation,
  contact,
  messages,
  onMessagesLoaded,
  onNewMessage,
  onUpdateMessage,
  onRemoveMessage,
  onConversationPatch,
  channel = null,
  agentsById = EMPTY_AGENTS,
  members = EMPTY_MEMBERS,
  onBack,
  resyncToken = 0,
  onRefresh,
  tags = EMPTY_TAGS,
  tagsById = EMPTY_TAG_MAP,
  onTagCreated,
  teams = EMPTY_TEAMS,
  teamMembers = EMPTY_TEAM_MEMBERS,
  quickReplies = EMPTY_QR,
}: MessageThreadProps) {
  const { user, profile } = useAuth();
  const { workspace, can } = useWorkspace();
  const { t, locale } = useI18n();
  const dateLocale = locale === "es" ? esLocale : enUS;
  const workspaceId = workspace?.id;
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [reactions, setReactions] = useState<MessageReaction[]>([]);
  const [aiBusy, setAiBusy] = useState(false);
  // Re-evaluated every minute so the AI-pause state and the reply window
  // expire on screen without a reload.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  // Purely visual spin state for the manual-refresh button. The actual
  // refetch is fire-and-forget through `onRefresh` (which bumps the
  // parent's resyncToken); the 700ms spin is just feedback so the click
  // doesn't feel like a no-op. Cleared via the timer ref on unmount.
  const [isRefreshing, setIsRefreshing] = useState(false);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (refreshTimerRef.current !== null) {
        clearTimeout(refreshTimerRef.current);
      }
    };
  }, []);
  const handleRefreshClick = useCallback(() => {
    if (isRefreshing || !onRefresh) return;
    setIsRefreshing(true);
    onRefresh();
    refreshTimerRef.current = setTimeout(() => {
      setIsRefreshing(false);
      refreshTimerRef.current = null;
    }, 700);
  }, [isRefreshing, onRefresh]);
  const [replyTo, setReplyTo] = useState<ReplyDraft | null>(null);
  const [events, setEvents] = useState<ConversationEvent[]>([]);
  const [view, setView] = useState<"chat" | "files">("chat");
  const [transferOpen, setTransferOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [showSimulator, setShowSimulator] = useState(false);
  const [simulatedText, setSimulatedText] = useState("");
  const [simulating, setSimulating] = useState(false);

  const capabilities = channelCapabilities(channel?.type);

  const handleSimulateSubmit = useCallback(async () => {
    if (!conversation || !simulatedText.trim() || simulating) return;
    setSimulating(true);

    try {
      const res = await fetch("/api/whatsapp/simulate-incoming", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: conversation.id,
          messageText: simulatedText.trim(),
        }),
      });

      const payload = await res.json().catch(() => ({}));

      if (!res.ok) {
        const reason = payload?.error || `HTTP ${res.status}`;
        console.error("Failed to simulate message:", reason);
        toast.error(t("inbox.simulator.failed", { reason }));
      } else {
        toast.success(t("inbox.simulator.success"));
        setSimulatedText("");
        setShowSimulator(false);
      }
    } catch (err) {
      console.error("Failed to simulate message:", err);
      const reason = err instanceof Error ? err.message : "network error";
      toast.error(t("inbox.simulator.failed", { reason }));
    } finally {
      setSimulating(false);
    }
  }, [conversation, simulatedText, simulating, t]);

  // Reply window per channel (WhatsApp / Instagram / Messenger 24 h,
  // TikTok 48 h, web chat never closes).
  const windowHours = capabilities.replyWindowHours;
  const sessionInfo = useMemo(() => {
    if (windowHours == null) return { applies: false, expired: false, remaining: "" };
    if (!messages.length) return { applies: true, expired: false, remaining: "" };

    // Find last customer message
    const lastCustomerMsg = [...messages]
      .reverse()
      .find((m) => m.sender_type === "customer");

    if (!lastCustomerMsg) {
      return { applies: true, expired: true, remaining: t("inbox.thread.window.noCustomer") };
    }

    const minutesLeft =
      windowHours * 60 - differenceInMinutes(now, new Date(lastCustomerMsg.created_at));

    if (minutesLeft <= 0) {
      return { applies: true, expired: true, remaining: t("inbox.thread.window.expired") };
    }

    const remaining =
      minutesLeft >= 60
        ? t("inbox.thread.window.hoursLeft", { n: Math.floor(minutesLeft / 60) })
        : t("inbox.thread.window.minutesLeft", { n: minutesLeft });

    return { applies: true, expired: false, remaining };
  }, [messages, windowHours, now, t]);

  // Store latest callback in a ref so fetchMessages doesn't need to
  // depend on `onMessagesLoaded` — otherwise parent re-renders cause
  // fetchMessages to change → useEffect re-fires → refetch → realtime
  // UPDATE on conversations.unread_count → parent re-renders → LOOP.
  // The ref is written inside an effect so the mutation doesn't happen
  // during render (React 19 refs rule); consumers only read `.current`
  // inside the async fetch completion, which runs after the render.
  const onMessagesLoadedRef = useRef(onMessagesLoaded);
  useEffect(() => {
    onMessagesLoadedRef.current = onMessagesLoaded;
  });

  const conversationId = conversation?.id;
  const hasUnread = (conversation?.unread_count ?? 0) > 0;

  // Fetch messages whenever the selected conversation changes. Kept
  // separate from the unread-reset effect so that incoming messages
  // arriving while the thread is open don't trigger a full refetch —
  // they only flip hasUnread, which only the reset effect listens to.
  useEffect(() => {
    if (!conversationId) return;

    const supabase = createClient();
    let cancelled = false;

    (async () => {
      setLoading(true);

      const { data, error } = await supabase
        .from("messages")
        .select("*")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true });

      if (cancelled) return;

      if (error) {
        console.error("Failed to fetch messages:", error);
      } else {
        onMessagesLoadedRef.current(data ?? []);
      }

      if (!cancelled) setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
    // `resyncToken` is included so the parent can force a refetch when
    // the realtime channel reconnects or the tab regains focus —
    // realtime is best-effort and any message events sent while the WS
    // was disconnected or throttled are otherwise lost.
  }, [conversationId, resyncToken]);

  // Reactions fetch — pulls the current state from the DB. Kept separate
  // from the channel subscription below so a `resyncToken` bump just
  // refetches the rows without also tearing down and rebuilding the
  // realtime channel.
  useEffect(() => {
    if (!conversationId) {
      setReactions([]);
      return;
    }
    const supabase = createClient();
    let cancelled = false;

    (async () => {
      const { data, error } = await supabase
        .from("message_reactions")
        .select("*")
        .eq("conversation_id", conversationId);
      if (cancelled) return;
      if (error) {
        console.error("Failed to fetch reactions:", error);
        return;
      }
      setReactions((data as MessageReaction[]) ?? []);
    })();

    return () => {
      cancelled = true;
    };
  }, [conversationId, resyncToken]);

  // Reactions realtime subscription per conversation. Subscribing here
  // (not at the page level) keeps the channel scoped to the visible
  // conversation and avoids cross-conversation chatter on a busy inbox.
  useEffect(() => {
    if (!conversationId) return;
    const supabase = createClient();

    const channel = supabase
      .channel(`reactions:${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "message_reactions",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const row = payload.new as MessageReaction;
          setReactions((prev) => {
            if (prev.some((r) => r.id === row.id)) return prev;
            // Swap any matching optimistic temp row for the real one so
            // the pill doesn't double up after a successful POST.
            const tempIdx = prev.findIndex(
              (r) =>
                r.id.startsWith("temp-") &&
                r.message_id === row.message_id &&
                r.actor_type === row.actor_type &&
                r.actor_id === row.actor_id,
            );
            if (tempIdx >= 0) {
              const copy = prev.slice();
              copy[tempIdx] = row;
              return copy;
            }
            return [...prev, row];
          });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "message_reactions",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const row = payload.new as MessageReaction;
          setReactions((prev) => prev.map((r) => (r.id === row.id ? row : r)));
        },
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "message_reactions",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const old = payload.old as Partial<MessageReaction>;
          if (!old?.id) return;
          setReactions((prev) => prev.filter((r) => r.id !== old.id));
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId]);

  // Clear any in-progress reply draft when the active conversation changes —
  // a quote pulled from conversation A shouldn't bleed into conversation B.
  useEffect(() => {
    setReplyTo(null);
    setShowSimulator(false);
    setSimulatedText("");
    setView("chat");
  }, [conversationId]);

  // Ownership / state timeline (conversation_events): fetched with the
  // messages and kept live per conversation.
  useEffect(() => {
    if (!conversationId) {
      setEvents([]);
      return;
    }
    const supabase = createClient();
    let cancelled = false;
    supabase
      .from("conversation_events")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .limit(500)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) console.error("Failed to fetch conversation events:", error.message);
        setEvents((data as ConversationEvent[]) ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId, resyncToken]);

  useEffect(() => {
    if (!conversationId) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`conv-events:${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "conversation_events",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const row = payload.new as ConversationEvent;
          setEvents((prev) => (prev.some((e) => e.id === row.id) ? prev : [...prev, row]));
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId]);

  // Reset the server-side unread_count to 0 whenever an unread count
  // surfaces on the active conversation — covers both (a) opening a
  // conversation that had unread messages and (b) new messages arriving
  // while the user is already viewing the thread (webhook server-bumps
  // unread_count to N+1; the realtime UPDATE propagates it into the
  // client, which re-runs this effect and flips it back to 0).
  //
  // Guarding on hasUnread prevents the eq-update loop: once unread_count
  // is 0 the condition is false, so no further UPDATE is issued.
  useEffect(() => {
    if (!conversationId || !hasUnread) return;
    const supabase = createClient();
    supabase
      .from("conversations")
      .update({ unread_count: 0 })
      .eq("id", conversationId)
      .then(({ error }) => {
        if (error) console.error("Failed to reset unread_count:", error);
      });
  }, [conversationId, hasUnread]);

  // Auto-scroll to bottom on new messages / events, and when the chat tab
  // comes back into view.
  useEffect(() => {
    if (scrollRef.current) {
      const el = scrollRef.current;
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, events, view]);

  /**
   * POST /api/whatsapp/send (channel-agnostic despite the path) and keep
   * the optimistic bubble in sync. Returns true when the provider took it.
   */
  const postSend = useCallback(
    async (tempId: string, body: Record<string, unknown>): Promise<boolean> => {
      try {
        const res = await fetch("/api/whatsapp/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        const payload = await res.json().catch(() => ({}));

        if (!res.ok || payload?.status === "failed") {
          const reason = payload?.error || `HTTP ${res.status}`;
          console.error("Failed to send message:", reason);
          toast.error(t("inbox.thread.sendFailed", { reason }));
          // Mark the optimistic bubble as failed so the user sees what happened
          onUpdateMessage(tempId, { status: "failed", metadata: { error: reason } });
          return false;
        }

        // Success — the realtime INSERT event will replace the temp bubble
        // with the real DB row. If realtime hasn't arrived yet, at least
        // flip status to 'sent' so the UI stops showing "sending".
        onUpdateMessage(tempId, { status: "sent" });
        return true;
      } catch (err) {
        console.error("Failed to send message:", err);
        const reason = err instanceof Error ? err.message : "network error";
        toast.error(t("inbox.thread.sendFailed", { reason }));
        onUpdateMessage(tempId, { status: "failed", metadata: { error: reason } });
        return false;
      }
    },
    [onUpdateMessage, t],
  );

  const handleSend = useCallback(
    async (text: string, replyToId?: string) => {
      if (!conversation) return;

      const tempId = `temp-${Date.now()}`;

      // Optimistic update — shows the message immediately with "sending" status
      const optimisticMsg: Message = {
        id: tempId,
        conversation_id: conversation.id,
        sender_type: "agent",
        content_type: "text",
        content_text: text,
        status: "sending",
        created_at: new Date().toISOString(),
        reply_to_message_id: replyToId,
      };
      onNewMessage(optimisticMsg);
      setReplyTo(null);

      await postSend(tempId, {
        conversation_id: conversation.id,
        message_type: "text",
        content_text: text,
        reply_to_message_id: replyToId,
      });
    },
    [conversation, onNewMessage, postSend]
  );

  /** Upload to the private `attachments` bucket, then send a signed URL. */
  const handleSendAttachment = useCallback(
    async (file: File, caption: string, replyToId?: string): Promise<boolean> => {
      if (!conversation || !workspaceId) return false;
      const kind = attachmentKind(file.type);
      if (!kind) {
        toast.error(t("inbox.composer.fileTypeNotAllowed"));
        return false;
      }

      const supabase = createClient();
      const path = `${workspaceId}/${conversation.id}/${crypto.randomUUID()}-${safeFileName(file.name)}`;
      const { error: uploadError } = await supabase.storage
        .from("attachments")
        .upload(path, file, { contentType: file.type, upsert: false });
      if (uploadError) {
        console.error("Attachment upload failed:", uploadError.message);
        toast.error(t("inbox.composer.uploadFailed", { reason: uploadError.message }));
        return false;
      }
      // Providers fetch the file once, right away; 1 h is plenty. The
      // bubble re-signs bucket URLs when rendering later.
      const { data: signed, error: signError } = await supabase.storage
        .from("attachments")
        .createSignedUrl(path, 3600);
      if (signError || !signed?.signedUrl) {
        toast.error(t("inbox.composer.uploadFailed", { reason: signError?.message ?? "sign" }));
        return false;
      }

      const contentText = caption || (kind === "document" ? file.name : "");
      const tempId = `temp-${Date.now()}`;
      onNewMessage({
        id: tempId,
        conversation_id: conversation.id,
        sender_type: "agent",
        content_type: kind,
        content_text: contentText || undefined,
        media_url: signed.signedUrl,
        status: "sending",
        created_at: new Date().toISOString(),
        reply_to_message_id: replyToId,
      });
      setReplyTo(null);

      // The upload succeeded, so the composer can clear even when the
      // provider rejects the send — the failed bubble shows the reason.
      await postSend(tempId, {
        conversation_id: conversation.id,
        message_type: kind,
        media_url: signed.signedUrl,
        content_text: contentText || undefined,
        reply_to_message_id: replyToId,
      });
      return true;
    },
    [conversation, workspaceId, onNewMessage, postSend, t],
  );

  /** Resend a failed text message: drop the failed row, send again. */
  const handleRetry = useCallback(
    async (msg: Message) => {
      if (!msg.content_text) return;
      onRemoveMessage?.(msg.id);
      if (!msg.id.startsWith("temp-")) {
        const { error } = await createClient().from("messages").delete().eq("id", msg.id);
        if (error) console.error("Failed to delete failed message:", error.message);
      }
      await handleSend(msg.content_text, msg.reply_to_message_id);
    },
    [handleSend, onRemoveMessage],
  );

  /** PATCH /api/conversations/[id]; applies the confirmed row to parent state. */
  const patchConversation = useCallback(
    async (body: Record<string, unknown>): Promise<boolean> => {
      if (!conversation) return false;
      try {
        const res = await fetch(`/api/conversations/${conversation.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok || !payload?.conversation) {
          toast.error(t("inbox.thread.updateFailed", { reason: payload?.error || `HTTP ${res.status}` }));
          return false;
        }
        onConversationPatch(conversation.id, patchFromRow(payload.conversation as Conversation));
        return true;
      } catch (err) {
        const reason = err instanceof Error ? err.message : "network error";
        toast.error(t("inbox.thread.updateFailed", { reason }));
        return false;
      }
    },
    [conversation, onConversationPatch, t],
  );

  const handleStatusChange = useCallback(
    (status: ConversationStatus) => {
      void patchConversation({ status });
    },
    [patchConversation]
  );

  const handlePriorityChange = useCallback(
    (priority: Priority) => {
      void patchConversation({ priority });
    },
    [patchConversation],
  );

  const handleResolveToggle = useCallback(async () => {
    if (!conversation) return;
    const resolving = conversation.status !== "closed";
    const ok = await patchConversation({ status: resolving ? "closed" : "open" });
    if (ok) toast.success(resolving ? t("inboxpro.header.resolved") : t("inboxpro.header.reopened"));
  }, [conversation, patchConversation, t]);

  const handleTagLinksChange = useCallback(
    (convId: string, links: ConversationTagLink[]) => {
      onConversationPatch(convId, { conversation_tags: links });
    },
    [onConversationPatch],
  );

  /** Internal note: optimistic yellow bubble, then POST …/notes. */
  const handleSendNote = useCallback(
    async (text: string, mentionIds: string[]): Promise<boolean> => {
      if (!conversation || !user) return false;
      const tempId = `temp-note-${Date.now()}`;
      onNewMessage({
        id: tempId,
        conversation_id: conversation.id,
        sender_type: "agent",
        sender_id: user.id,
        content_type: "text",
        content_text: text,
        status: "sending",
        created_at: new Date().toISOString(),
        is_internal: true,
      });
      try {
        const res = await fetch(`/api/conversations/${conversation.id}/notes`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, mentions: mentionIds }),
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok || !payload?.message) throw new Error(payload?.error || `HTTP ${res.status}`);
        onRemoveMessage?.(tempId);
        onNewMessage(payload.message as Message);
        return true;
      } catch (err) {
        onRemoveMessage?.(tempId);
        toast.error(t("inboxpro.composer.noteFailed", { reason: err instanceof Error ? err.message : "error" }));
        return false;
      }
    },
    [conversation, user, onNewMessage, onRemoveMessage, t],
  );

  /** A quick reply's stored files go out as media messages, in order. */
  const handleSendQuickAttachments = useCallback(
    async (attachments: QuickReplyAttachment[]) => {
      if (!conversation) return;
      const supabase = createClient();
      for (const a of attachments) {
        let url = a.url ?? null;
        if (a.path) {
          const { data } = await supabase.storage.from("attachments").createSignedUrl(a.path, 3600);
          url = data?.signedUrl ?? null;
        }
        if (!url) {
          toast.error(t("inboxpro.composer.attachmentFailed", { name: a.name }));
          continue;
        }
        const caption = a.type === "document" ? a.name : undefined;
        const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        onNewMessage({
          id: tempId,
          conversation_id: conversation.id,
          sender_type: "agent",
          content_type: a.type,
          content_text: caption,
          media_url: url,
          status: "sending",
          created_at: new Date().toISOString(),
        });
        await postSend(tempId, {
          conversation_id: conversation.id,
          message_type: a.type,
          media_url: url,
          content_text: caption,
        });
      }
    },
    [conversation, onNewMessage, postSend, t],
  );

  const handleTransferred = useCallback(
    (row: Conversation) => {
      onConversationPatch(row.id, patchFromRow(row));
    },
    [onConversationPatch],
  );

  const handleAssignChange = useCallback(
    (agentId: string | null) => {
      void patchConversation({ assigned_agent_id: agentId });
    },
    [patchConversation],
  );

  const handleAiToggle = useCallback(
    async (action: "pause" | "resume") => {
      setAiBusy(true);
      const ok = await patchConversation({ ai_paused_until: action });
      setAiBusy(false);
      if (ok) {
        toast.success(
          action === "pause" ? t("inbox.thread.ai.tookOver") : t("inbox.thread.ai.handedBack"),
        );
      }
    },
    [patchConversation, t],
  );

  const handleAiAgentChange = useCallback(
    async (agentId: string | null) => {
      setAiBusy(true);
      const ok = await patchConversation({ ai_agent_id: agentId });
      setAiBusy(false);
      if (!ok) return;
      const name = agentId ? agentsById.get(agentId)?.name : null;
      toast.success(name ? t("routing.inbox.changed", { name }) : t("routing.inbox.cleared"));
    },
    [patchConversation, agentsById, t],
  );

  const handleOpenTemplates = useCallback(() => {
    setTemplateModalOpen(true);
  }, []);

  const handleSendTemplate = useCallback(
    async (template: MessageTemplate, params: string[]) => {
      if (!conversation) return;

      const renderedBody = renderTemplateBody(template.body_text, params);
      const tempId = `temp-${Date.now()}`;

      const optimisticMsg: Message = {
        id: tempId,
        conversation_id: conversation.id,
        sender_type: "agent",
        content_type: "template",
        content_text: renderedBody,
        template_name: template.name,
        status: "sending",
        created_at: new Date().toISOString(),
      };
      onNewMessage(optimisticMsg);

      await postSend(tempId, {
        conversation_id: conversation.id,
        message_type: "template",
        template_name: template.name,
        template_params: params,
        content_text: renderedBody,
      });
    },
    [conversation, onNewMessage, postSend],
  );

  // Build a quick id → Message map so reply quotes can be rendered without
  // an extra fetch — the thread already holds the full conversation.
  const messagesById = useMemo(() => {
    const map = new Map<string, Message>();
    for (const m of messages) map.set(m.id, m);
    return map;
  }, [messages]);

  // Customer images the bot took as payment proof: the latest customer
  // image before each bot message tagged event 'payment_proof'.
  const paymentProofIds = useMemo(() => {
    const ids = new Set<string>();
    let lastImage: string | null = null;
    for (const m of messages) {
      if (m.sender_type === "customer" && m.content_type === "image") lastImage = m.id;
      else if (
        m.sender_type !== "customer" &&
        (m.metadata as Record<string, unknown> | null | undefined)?.event === "payment_proof" &&
        lastImage
      ) {
        ids.add(lastImage);
        lastImage = null;
      }
    }
    return ids;
  }, [messages]);

  const membersByUserId = useMemo(() => new Map(members.map((m) => [m.user_id, m])), [members]);
  const memberNameList = useMemo(
    () => members.map((m) => (m.full_name || "").trim()).filter(Boolean),
    [members],
  );
  const mentionCandidates = useMemo<MentionCandidate[]>(
    () =>
      members
        .filter((m) => m.user_id !== user?.id && (m.full_name || "").trim())
        .map((m) => ({ userId: m.user_id, name: m.full_name.trim() })),
    [members, user?.id],
  );
  const nameOfUser = useCallback(
    (uid: string | null): string => {
      if (!uid) return t("inboxpro.events.someone");
      const m = membersByUserId.get(uid);
      return m?.full_name || m?.email || t("inboxpro.events.someone");
    },
    [membersByUserId, t],
  );
  const teamName = useCallback(
    (id: string | null): string => (id ? (teams.find((tm) => tm.id === id)?.name ?? "—") : "—"),
    [teams],
  );

  // Messages + ownership events in one chronological timeline.
  const timeline = useMemo<TimelineItem[]>(() => {
    const items: TimelineItem[] = messages.map((m) => ({ kind: "message", at: m.created_at, message: m }));
    for (const e of events) items.push({ kind: "event", at: e.created_at, event: e });
    // Stable: messages keep their order; events slot in by time.
    return items
      .map((it, i) => ({ it, i }))
      .sort((a, b) => {
        const d = Date.parse(a.it.at) - Date.parse(b.it.at);
        return d !== 0 ? d : a.i - b.i;
      })
      .map((x) => x.it);
  }, [messages, events]);

  // Bucket reactions by their target message_id for O(1) per-bubble lookup.
  const reactionsByMessageId = useMemo(() => {
    const map = new Map<string, MessageReaction[]>();
    for (const r of reactions) {
      const bucket = map.get(r.message_id);
      if (bucket) bucket.push(r);
      else map.set(r.message_id, [r]);
    }
    return map;
  }, [reactions]);

  const contactDisplayName = contact?.name || contact?.phone || t("inbox.thread.customer");
  const youLabel = t("inbox.thread.you");

  // Author label for a quoted message: "You" when we sent the parent,
  // contact name when the customer sent it.
  const authorLabelFor = useCallback(
    (m: Message): string => {
      const isAgentMsg =
        m.sender_type === "agent" || m.sender_type === "bot";
      return isAgentMsg ? youLabel : contactDisplayName;
    },
    [contactDisplayName, youLabel],
  );

  const handleStartReply = useCallback(
    (msg: Message) => {
      setReplyTo({
        id: msg.id,
        authorLabel: authorLabelFor(msg),
        preview: buildReplyPreview(msg),
      });
    },
    [authorLabelFor],
  );

  // Single reaction-set primitive. emoji === "" removes; otherwise adds/swaps.
  // The "toggle" semantic (pill click) is computed at the call site where the
  // current reactions for the bubble are already in scope — keeps this
  // function dependency-free w.r.t. the reaction list.
  const postReaction = useCallback(
    async (messageId: string, emoji: string) => {
      if (!user?.id || !conversation) {
        console.warn("[reactions] missing user or conversation");
        return;
      }
      if (messageId.startsWith("temp-")) {
        toast.error(t("inbox.thread.waitForSend"));
        return;
      }

      const convId = conversation.id;
      const userId = user.id;
      let snapshot: MessageReaction[] = [];

      // Functional updater — captures the freshest reactions list, never a
      // stale closure. Snapshot stored for rollback on POST failure.
      setReactions((prev) => {
        snapshot = prev;
        const own = prev.find(
          (r) =>
            r.message_id === messageId &&
            r.actor_type === "agent" &&
            r.actor_id === userId,
        );
        if (emoji === "") return own ? prev.filter((r) => r !== own) : prev;
        if (own) return prev.map((r) => (r === own ? { ...own, emoji } : r));
        return [
          ...prev,
          {
            id: `temp-${Date.now()}`,
            message_id: messageId,
            conversation_id: convId,
            actor_type: "agent",
            actor_id: userId,
            emoji,
            created_at: new Date().toISOString(),
          },
        ];
      });

      try {
        const res = await fetch("/api/whatsapp/react", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message_id: messageId, emoji }),
        });
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          throw new Error(payload?.error || `HTTP ${res.status}`);
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : "network error";
        toast.error(t("inbox.thread.reactionFailed", { reason }));
        setReactions(snapshot);
      }
    },
    [conversation, user?.id, t],
  );

  // Empty state — same WhatsApp-style doodle background as the active
  // thread below, so swapping between empty/selected doesn't change the
  // pattern under the user's eye.
  if (!conversation || !contact) {
    return (
      <div className={cn("flex flex-1 flex-col items-center justify-center", DOODLE_BG_CLASSES)}>
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-800">
          <MessageSquare className="h-8 w-8 text-slate-600" />
        </div>
        <h3 className="mt-4 text-sm font-medium text-slate-400">
          {t("inbox.thread.selectTitle")}
        </h3>
        <p className="mt-1 text-xs text-slate-600">
          {t("inbox.thread.selectHint")}
        </p>
      </div>
    );
  }

  const displayName = contact.name || contact.phone || t("inbox.thread.customer");
  const timelineGroups = groupByDate(timeline);
  const isResolved = conversation.status === "closed";
  const quickReplyVars = {
    nombre: contact.name || null,
    negocio: workspace?.name ?? null,
    agente: profile?.full_name || null,
    fecha: formatToday(workspace?.timezone, locale),
  };
  const currentStatus = STATUS_OPTIONS.find(
    (s) => s.value === conversation.status
  );
  const assignedAgentId = conversation.assigned_agent_id ?? null;
  const currentAssignee = members.find((p) => p.user_id === assignedAgentId);
  const assignLabel = assignedAgentId
    ? (currentAssignee?.full_name || t("inbox.thread.assigned"))
    : t("inbox.thread.assign");

  // AI agent handling the conversation: its own (menu choice, transfer,
  // flow, manual) or else the channel's; and whether a human has taken
  // over (ai_paused_until in the future).
  const conversationAgentId = conversation.ai_agent_id ?? null;
  const effectiveAgentId = conversationAgentId ?? channel?.ai_agent_id ?? null;
  const channelAgent = channel?.ai_agent_id ? agentsById.get(channel.ai_agent_id) : undefined;
  const currentAgent = effectiveAgentId ? agentsById.get(effectiveAgentId) : undefined;
  const hasAi = !!effectiveAgentId;
  const selectableAgents = [...agentsById.values()].filter((a) => a.enabled !== false);
  const showAiBar = hasAi || selectableAgents.length > 0;
  const pausedUntil = conversation.ai_paused_until ? new Date(conversation.ai_paused_until) : null;
  const aiPaused = !!pausedUntil && pausedUntil.getTime() > now;
  const agentName = currentAgent?.name ?? t("inbox.bubble.aiAgent");

  const formatDateSeparator = (dateStr: string): string => {
    const date = new Date(dateStr);
    if (isToday(date)) return t("inbox.thread.today");
    if (isYesterday(date)) return t("inbox.thread.yesterday");
    return format(date, locale === "es" ? "d 'de' MMMM 'de' yyyy" : "MMMM d, yyyy", {
      locale: dateLocale,
    });
  };

  return (
    <div className={cn("flex min-w-0 flex-1 flex-col", DOODLE_BG_CLASSES)}>
      {/* Header — solid bg-slate-900 sits on top of the doodle so the
          name/avatar/dropdowns stay legible. */}
      <div className="flex items-center justify-between gap-2 border-b border-slate-800 bg-slate-900 px-3 py-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          {/* Back-to-list button — mobile only. Hidden on lg+ where the
              conversation list is always visible next to the thread. */}
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              aria-label={t("inbox.thread.back")}
              className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md text-slate-300 hover:bg-slate-800 hover:text-white lg:hidden"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
          )}
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-slate-700 text-sm font-medium text-white">
            {displayName.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-white">{displayName}</h2>
            <p className="flex min-w-0 items-center gap-2 text-xs text-slate-400">
              <ChannelBadge channel={channel} className="max-w-full shrink-0" />
              {contact.phone && channel?.type === "whatsapp" && (
                <span className="hidden min-w-0 truncate text-slate-500 xl:inline">{contact.phone}</span>
              )}
            </p>
          </div>
          {/* Reply-window badge — only where the channel has one; hidden
              on the narrowest phones so the name + back arrow keep room. */}
          {sessionInfo.applies && sessionInfo.remaining && (
            <Badge
              variant="outline"
              className={cn(
                "ml-1 hidden gap-1 border-slate-700 text-[10px] sm:inline-flex sm:ml-2",
                sessionInfo.expired ? "text-red-400" : "text-primary"
              )}
            >
              <Clock className="h-3 w-3" />
              {sessionInfo.remaining}
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Manual refresh — forces a refetch of the messages + the
              conversation list (the parent bumps its resyncToken). Useful
              when realtime missed an event or the agent just wants to be
              sure nothing's stale. Only rendered when the parent wires
              up `onRefresh`. */}
          {onRefresh && (
            <button
              type="button"
              onClick={handleRefreshClick}
              disabled={isRefreshing}
              aria-label={t("inbox.thread.refresh")}
              title={t("inbox.thread.refresh")}
              className={cn(
                "hidden h-7 w-7 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-800 hover:text-white disabled:opacity-60 sm:inline-flex",
              )}
            >
              <RefreshCw
                className={cn("h-3.5 w-3.5", isRefreshing && "animate-spin")}
              />
            </button>
          )}

          {/* Customer-message simulator (testing aid) */}
          <button
            type="button"
            onClick={() => setShowSimulator(prev => !prev)}
            aria-label={t("inbox.simulator.button")}
            title={t("inbox.simulator.button")}
            className={cn(
              "hidden h-7 px-2 items-center justify-center gap-1 rounded-md text-xs transition-colors border sm:inline-flex",
              showSimulator
                ? "bg-teal-500/10 border-teal-500/30 text-teal-300"
                : "border-slate-700 bg-slate-800/50 text-slate-400 hover:bg-slate-800 hover:text-white"
            )}
          >
            <Sparkles className="h-3 w-3 text-teal-400" />
            <span className="hidden whitespace-nowrap 2xl:inline">{t("inbox.simulator.button")}</span>
          </button>

          <PriorityPicker value={conversation.priority} onChange={handlePriorityChange} />

          {/* Status dropdown ('closed' is shown as "Resuelta") */}
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={`${t("inbox.thread.status")}: ${currentStatus ? t(`inboxpro.status.${currentStatus.value}`) : ""}`}
              className={cn(
                  "hidden items-center justify-center h-7 gap-1 px-2 text-xs rounded-md hover:bg-slate-800 md:inline-flex",
                  currentStatus?.color ?? "text-slate-400"
                )}>
                {currentStatus ? t(`inboxpro.status.${currentStatus.value}`) : t("inbox.thread.status")}
                <ChevronDown className="h-3 w-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="border-slate-700 bg-slate-800"
            >
              {STATUS_OPTIONS.map((opt) => (
                <DropdownMenuItem
                  key={opt.value}
                  onClick={() => handleStatusChange(opt.value)}
                  className={cn("text-sm", opt.color)}
                >
                  {t(`inboxpro.status.${opt.value}`)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Assign dropdown — scoped to active workspace members */}
          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn(
                "inline-flex items-center justify-center h-7 gap-1 px-2 text-xs rounded-md hover:bg-slate-800",
                assignedAgentId ? "text-primary" : "text-slate-400"
              )}
              aria-label={t("inbox.thread.assign")}
            >
              <UserPlus className="h-3 w-3" />
              <span className="hidden max-w-28 truncate sm:inline">{assignLabel}</span>
              <ChevronDown className="h-3 w-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="border-slate-700 bg-slate-800"
            >
              {members.length === 0 ? (
                <DropdownMenuItem disabled className="text-sm text-slate-500">
                  {t("inbox.thread.noTeammates")}
                </DropdownMenuItem>
              ) : (
                members.map((p) => {
                  const isSelected = p.user_id === assignedAgentId;
                  return (
                    <DropdownMenuItem
                      key={p.id}
                      onClick={() => handleAssignChange(p.user_id)}
                      className={cn(
                        "text-sm",
                        isSelected ? "text-primary" : "text-slate-300"
                      )}
                    >
                      <span className="flex-1">
                        {p.full_name || p.email}
                        {p.user_id === user?.id ? ` ${t("inbox.thread.me")}` : ""}
                      </span>
                      {isSelected && <Check className="ml-2 h-3 w-3" />}
                    </DropdownMenuItem>
                  );
                })
              )}
              {assignedAgentId && (
                <>
                  <DropdownMenuSeparator className="bg-slate-700" />
                  <DropdownMenuItem
                    onClick={() => handleAssignChange(null)}
                    className="text-sm text-slate-400"
                  >
                    {t("inbox.thread.unassign")}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* AI summary of the conversation (AI assist) */}
          <button
            type="button"
            onClick={() => setSummaryOpen(true)}
            aria-label={t("aiassist.summary.button")}
            title={t("aiassist.summary.button")}
            className="inline-flex h-7 items-center justify-center gap-1 rounded-md px-2 text-xs text-violet-300 hover:bg-slate-800 hover:text-violet-200"
          >
            <NotebookText className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="hidden 2xl:inline">{t("aiassist.summary.button")}</span>
          </button>

          {/* Transfer to a member / team with a reason */}
          <button
            type="button"
            onClick={() => setTransferOpen(true)}
            aria-label={t("inboxpro.header.transfer")}
            title={t("inboxpro.header.transfer")}
            className="inline-flex h-7 items-center justify-center gap-1 rounded-md px-2 text-xs text-slate-300 hover:bg-slate-800 hover:text-white"
          >
            <ArrowRightLeft className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="hidden 2xl:inline">{t("inboxpro.header.transfer")}</span>
          </button>

          {/* Resolve / reopen */}
          <button
            type="button"
            onClick={() => void handleResolveToggle()}
            className={cn(
              "inline-flex h-7 items-center justify-center gap-1 rounded-md border px-2 text-xs font-medium transition-colors",
              isResolved
                ? "border-slate-600 text-slate-200 hover:bg-slate-800"
                : "border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20",
            )}
          >
            {isResolved ? (
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            <span className="hidden sm:inline">
              {isResolved ? t("inboxpro.header.reopen") : t("inboxpro.header.resolve")}
            </span>
            <span className="sr-only sm:hidden">
              {isResolved ? t("inboxpro.header.reopen") : t("inboxpro.header.resolve")}
            </span>
          </button>
        </div>
      </div>

      {/* Tags + Chat / Files tabs */}
      <div className="flex shrink-0 items-center gap-2 border-b border-slate-800 bg-slate-900/95 px-3 py-1.5 sm:px-4">
        <ConversationTags
          conversationId={conversation.id}
          links={conversation.conversation_tags ?? EMPTY_LINKS}
          tags={tags}
          tagsById={tagsById}
          canCreate={can("admin")}
          onLinksChange={handleTagLinksChange}
          onTagCreated={(tag) => onTagCreated?.(tag)}
        />
        <div role="tablist" aria-label={t("inboxpro.header.viewTabs")} className="flex shrink-0 rounded-md border border-slate-700 p-0.5">
          {(["chat", "files"] as const).map((v) => {
            const active = view === v;
            const Icon = v === "chat" ? MessagesSquare : Paperclip;
            return (
              <button
                key={v}
                type="button"
                role="tab"
                id={`thread-tab-${v}`}
                aria-selected={active}
                aria-controls={`thread-panel-${v}`}
                tabIndex={active ? 0 : -1}
                onClick={() => setView(v)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                    e.preventDefault();
                    const next = v === "chat" ? "files" : "chat";
                    setView(next);
                    document.getElementById(`thread-tab-${next}`)?.focus();
                  }
                }}
                className={cn(
                  "inline-flex h-6 items-center gap-1 rounded px-2 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                  active ? "bg-slate-700 text-white" : "text-slate-400 hover:text-white",
                )}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">{v === "chat" ? t("inboxpro.header.chat") : t("inboxpro.header.files")}</span>
                <span className="sr-only sm:hidden">{v === "chat" ? t("inboxpro.header.chat") : t("inboxpro.header.files")}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* AI control bar — who handles the conversation (agent picker) and
          the take-over / give-back toggle. */}
      {showAiBar && (
        <div
          className={cn(
            "flex shrink-0 items-center justify-between gap-2 border-b px-3 py-1.5 sm:px-4",
            aiPaused
              ? "border-amber-500/20 bg-amber-500/10"
              : "border-primary/20 bg-primary/10",
          )}
        >
          <div className="flex min-w-0 items-center gap-1.5 text-xs">
            {aiPaused ? (
              <PauseCircle className="h-3.5 w-3.5 shrink-0 text-amber-400" />
            ) : (
              <Bot className="h-3.5 w-3.5 shrink-0 text-primary" />
            )}
            <span className={cn("truncate", aiPaused ? "text-amber-300" : "text-slate-200")}>
              {!hasAi
                ? t("routing.inbox.noAiConfigured")
                : aiPaused && pausedUntil
                  ? t("inbox.thread.ai.pausedUntil", {
                      name: agentName,
                      time: format(pausedUntil, "HH:mm", { locale: dateLocale }),
                    })
                  : t("inbox.thread.ai.handledBy", { name: agentName })}
            </span>
            {hasAi && !conversationAgentId && (
              <span className="hidden shrink-0 rounded bg-slate-800/70 px-1 text-[10px] text-slate-400 sm:inline">
                {t("routing.inbox.fromChannel")}
              </span>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger
                disabled={aiBusy}
                aria-label={t("routing.inbox.change")}
                title={t("routing.inbox.change")}
                className="inline-flex h-6 shrink-0 items-center gap-0.5 rounded-md px-1.5 text-[11px] text-slate-300 hover:bg-slate-800 hover:text-white disabled:opacity-60"
              >
                <span className="hidden sm:inline">{t("routing.inbox.change")}</span>
                <ChevronDown className="h-3 w-3" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="border-slate-700 bg-slate-800">
                {selectableAgents.map((a) => {
                  const selected = a.id === conversationAgentId;
                  return (
                    <DropdownMenuItem
                      key={a.id}
                      onClick={() => void handleAiAgentChange(a.id)}
                      className={cn("text-sm", selected ? "text-primary" : "text-slate-300")}
                    >
                      <Bot className="h-3.5 w-3.5" />
                      <span className="flex-1">{a.name}</span>
                      {selected && <Check className="ml-2 h-3 w-3" />}
                    </DropdownMenuItem>
                  );
                })}
                <DropdownMenuSeparator className="bg-slate-700" />
                <DropdownMenuItem
                  onClick={() => void handleAiAgentChange(null)}
                  className={cn("text-sm", !conversationAgentId ? "text-primary" : "text-slate-400")}
                >
                  <span className="flex-1">
                    {channelAgent
                      ? t("routing.inbox.noneChannel", { name: channelAgent.name })
                      : t("routing.inbox.none")}
                  </span>
                  {!conversationAgentId && <Check className="ml-2 h-3 w-3" />}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {hasAi && (
          <Button
            size="sm"
            variant="ghost"
            disabled={aiBusy}
            onClick={() => handleAiToggle(aiPaused ? "resume" : "pause")}
            className={cn(
              "h-7 shrink-0 gap-1 px-2 text-xs",
              aiPaused
                ? "text-amber-300 hover:bg-amber-500/20 hover:text-amber-200"
                : "text-primary hover:bg-primary/20",
            )}
          >
            {aiPaused ? <Bot className="h-3.5 w-3.5" /> : <Hand className="h-3.5 w-3.5" />}
            {aiPaused ? t("inbox.thread.ai.giveBack") : t("inbox.thread.ai.take")}
          </Button>
          )}
        </div>
      )}

      {/* Customer Message Simulator Bar */}
      {showSimulator && (
        <div className="flex flex-col gap-2 border-b border-teal-500/20 bg-teal-500/10 px-4 py-2.5 shrink-0">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-teal-400 flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 animate-pulse" /> {t("inbox.simulator.title")}
            </span>
            <button
              onClick={() => {
                setShowSimulator(false);
                setSimulatedText("");
              }}
              className="text-[10px] text-slate-400 hover:text-white"
            >
              {t("inbox.simulator.cancel")}
            </button>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={simulatedText}
              onChange={(e) => setSimulatedText(e.target.value)}
              placeholder={t("inbox.simulator.placeholder")}
              aria-label={t("inbox.simulator.title")}
              className="flex-1 rounded-md border border-teal-500/30 bg-slate-900/60 px-3 py-1.5 text-xs text-white placeholder-slate-500 outline-none focus:border-teal-500/50"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleSimulateSubmit();
                }
              }}
              disabled={simulating}
            />
            <Button
              size="sm"
              onClick={handleSimulateSubmit}
              disabled={simulating || !simulatedText.trim()}
              className="h-8 bg-teal-600 hover:bg-teal-500 text-white text-xs px-3"
            >
              {simulating ? t("inbox.simulator.sending") : t("inbox.simulator.send")}
            </Button>
          </div>
        </div>
      )}

      {view === "files" && (
        <div
          id="thread-panel-files"
          role="tabpanel"
          aria-labelledby="thread-tab-files"
          className="flex min-h-0 flex-1 flex-col bg-slate-950"
        >
          <ConversationFiles
            conversationId={conversation.id}
            contactName={displayName}
            membersByUserId={membersByUserId}
            agentsById={agentsById}
            refreshKey={messages.length}
          />
        </div>
      )}

      {/* Messages Area */}
      <div
        ref={scrollRef}
        id="thread-panel-chat"
        role="tabpanel"
        aria-labelledby="thread-tab-chat"
        hidden={view !== "chat"}
        className={cn("flex-1 overflow-y-auto px-4 py-4", view !== "chat" && "hidden")}
      >
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : timeline.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12">
            <p className="text-sm text-slate-500">{t("inbox.thread.noMessages")}</p>
            {capabilities.templates && (
              <p className="text-xs text-slate-600">
                {t("inbox.thread.noMessagesHint")}
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {timelineGroups.map((group) => (
              <div key={group.date}>
                {/* Date separator */}
                <div className="mb-4 flex items-center justify-center">
                  <span className="rounded-full bg-slate-800 px-3 py-1 text-[10px] font-medium text-slate-400">
                    {formatDateSeparator(group.date)}
                  </span>
                </div>
                {/* Messages */}
                <div className="space-y-2">
                  {group.items.map((item) => {
                    if (item.kind === "event") {
                      return (
                        <EventDivider
                          key={`ev-${item.event.id}`}
                          event={item.event}
                          nameOf={nameOfUser}
                          teamName={teamName}
                        />
                      );
                    }
                    const msg = item.message;
                    if (msg.is_internal) {
                      return (
                        <NoteBubble
                          key={msg.id}
                          message={msg}
                          authorName={nameOfUser(msg.sender_id ?? null)}
                          memberNames={memberNameList}
                        />
                      );
                    }
                    if (msg.content_type === "system") {
                      return <MessageBubble key={msg.id} message={msg} />;
                    }
                    const parent = msg.reply_to_message_id
                      ? messagesById.get(msg.reply_to_message_id)
                      : null;
                    const reply = parent
                      ? {
                          authorLabel: authorLabelFor(parent),
                          preview: buildReplyPreview(parent),
                        }
                      : null;
                    const msgReactions = reactionsByMessageId.get(msg.id);
                    // Toggle is computed at the call site — `msgReactions`
                    // and `user?.id` are already in scope, no extra hook.
                    const handlePillToggle = (emoji: string) => {
                      const own = msgReactions?.find(
                        (r) =>
                          r.actor_type === "agent" &&
                          r.actor_id === user?.id,
                      );
                      const next = own?.emoji === emoji ? "" : emoji;
                      void postReaction(msg.id, next);
                    };
                    const canRetry =
                      msg.status === "failed" &&
                      msg.sender_type === "agent" &&
                      msg.content_type === "text" &&
                      !!msg.content_text &&
                      !sessionInfo.expired;
                    return (
                      <MessageActions
                        key={msg.id}
                        message={msg}
                        canReact={capabilities.reactions}
                        onReply={() => handleStartReply(msg)}
                        onReact={(emoji) => {
                          if (emoji) void postReaction(msg.id, emoji);
                        }}
                      >
                        <MessageBubble
                          message={msg}
                          reply={reply}
                          reactions={msgReactions}
                          currentUserId={user?.id}
                          onToggleReaction={capabilities.reactions ? handlePillToggle : undefined}
                          agentName={
                            msg.ai_agent_id
                              ? (agentsById.get(msg.ai_agent_id)?.name ?? null)
                              : null
                          }
                          onRetry={canRetry ? () => void handleRetry(msg) : undefined}
                          isPaymentProof={paymentProofIds.has(msg.id)}
                        />
                      </MessageActions>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Composer */}
      <MessageComposer
        conversationId={conversation.id}
        sessionExpired={sessionInfo.expired}
        capabilities={capabilities}
        onSend={handleSend}
        onOpenTemplates={handleOpenTemplates}
        onSendAttachment={handleSendAttachment}
        replyTo={replyTo}
        onClearReply={() => setReplyTo(null)}
        onSendNote={handleSendNote}
        mentionCandidates={mentionCandidates}
        quickReplies={quickReplies}
        quickReplyVars={quickReplyVars}
        onSendQuickAttachments={handleSendQuickAttachments}
      />

      <SummarySheet
        open={summaryOpen}
        onOpenChange={setSummaryOpen}
        conversationId={conversation.id}
        nameOf={(uid) => (uid ? nameOfUser(uid) : null)}
        canManageSettings={can("admin")}
      />

      <TransferDialog
        open={transferOpen}
        onOpenChange={setTransferOpen}
        conversationId={conversation.id}
        members={teamMembers}
        teams={teams}
        currentUserId={user?.id ?? null}
        currentAssigneeId={assignedAgentId}
        onTransferred={handleTransferred}
      />

      {capabilities.templates && (
        <TemplatePicker
          open={templateModalOpen}
          onOpenChange={setTemplateModalOpen}
          onSelect={handleSendTemplate}
          channelId={channel?.id ?? null}
        />
      )}
    </div>
  );
}

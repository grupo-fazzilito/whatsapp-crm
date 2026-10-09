"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useWorkspace } from "@/hooks/use-workspace";
import { useRealtimeChanges, useRealtimeConnected } from "@/lib/realtime/client";
import type { RealtimeChange } from "@/lib/realtime/types";
import type { Message, Conversation } from "@/types";

interface RealtimeEvent<T> {
  eventType: "INSERT" | "UPDATE" | "DELETE";
  new: T;
  old: Partial<T>;
}

/** conversation_tags row (DELETE payloads only carry the key columns). */
export interface ConversationTagRow {
  id: string;
  conversation_id?: string;
  tag_id?: string;
}

interface UseRealtimeOptions {
  /** Kept for callers; the app-wide stream (/api/realtime) needs no channel name. */
  channelName: string;
  onMessageEvent?: (event: RealtimeEvent<Message>) => void;
  onConversationEvent?: (event: RealtimeEvent<Conversation>) => void;
  /** Tags added to / removed from conversations (inbox list chips). */
  onConversationTagEvent?: (event: RealtimeEvent<ConversationTagRow>) => void;
  enabled?: boolean;
}

const TABLES = ["messages", "conversations", "conversation_tags"] as const;

/**
 * Inbox row changes of the active workspace (messages, conversations,
 * conversation tags) over the shared realtime stream.
 */
export function useRealtime({
  onMessageEvent,
  onConversationEvent,
  onConversationTagEvent,
  enabled = true,
}: UseRealtimeOptions) {
  const { workspace } = useWorkspace();
  const workspaceId = workspace?.id;
  const [stopped, setStopped] = useState(false);
  const streamConnected = useRealtimeConnected();
  const active = enabled && !stopped && !!workspaceId;

  // Latest callbacks in refs so a parent re-render with fresh closures
  // doesn't matter (assigned in an effect: React 19 refs rule).
  const onMessageRef = useRef(onMessageEvent);
  const onConversationRef = useRef(onConversationEvent);
  const onConversationTagRef = useRef(onConversationTagEvent);
  useEffect(() => {
    onMessageRef.current = onMessageEvent;
    onConversationRef.current = onConversationEvent;
    onConversationTagRef.current = onConversationTagEvent;
  });

  useRealtimeChanges({
    workspaceId,
    tables: [...TABLES],
    enabled: active,
    onChange: (change: RealtimeChange) => {
      const event = { eventType: change.eventType, new: change.new, old: change.old };
      if (change.table === "messages") {
        onMessageRef.current?.(event as unknown as RealtimeEvent<Message>);
      } else if (change.table === "conversations") {
        onConversationRef.current?.(event as unknown as RealtimeEvent<Conversation>);
      } else if (change.table === "conversation_tags") {
        // Only additions and removals matter to the inbox chips.
        if (change.eventType === "INSERT") {
          onConversationTagRef.current?.({ eventType: "INSERT", new: change.new as unknown as ConversationTagRow, old: {} });
        } else if (change.eventType === "DELETE") {
          onConversationTagRef.current?.({
            eventType: "DELETE",
            new: {} as ConversationTagRow,
            old: change.old as Partial<ConversationTagRow>,
          });
        }
      }
    },
  });

  const unsubscribe = useCallback(() => setStopped(true), []);

  return { isConnected: active && streamConnected, unsubscribe };
}

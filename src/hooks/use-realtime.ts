"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useWorkspace } from "@/hooks/use-workspace";
import type { Message, Conversation } from "@/types";
import type { RealtimeChannel } from "@supabase/supabase-js";

interface RealtimeEvent<T> {
  eventType: "INSERT" | "UPDATE" | "DELETE";
  new: T;
  old: Partial<T>;
}

/** conversation_tags row (DELETE payloads only carry the id under RLS). */
export interface ConversationTagRow {
  id: string;
  conversation_id?: string;
  tag_id?: string;
}

interface UseRealtimeOptions {
  channelName: string;
  onMessageEvent?: (event: RealtimeEvent<Message>) => void;
  onConversationEvent?: (event: RealtimeEvent<Conversation>) => void;
  /** Tags added to / removed from conversations (inbox list chips). */
  onConversationTagEvent?: (event: RealtimeEvent<ConversationTagRow>) => void;
  enabled?: boolean;
}

export function useRealtime({
  channelName,
  onMessageEvent,
  onConversationEvent,
  onConversationTagEvent,
  enabled = true,
}: UseRealtimeOptions) {
  const channelRef = useRef<RealtimeChannel | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const { workspace } = useWorkspace();
  const workspaceId = workspace?.id;

  // Store latest callbacks in refs to avoid re-subscribing when the
  // parent re-renders with fresh closures. Assigned inside an effect
  // so the mutation doesn't happen during render (React 19's refs
  // rule) — subscribers only read `.current` inside async Realtime
  // callbacks, which always run after the render that updates it.
  const onMessageRef = useRef(onMessageEvent);
  const onConversationRef = useRef(onConversationEvent);
  const onConversationTagRef = useRef(onConversationTagEvent);
  useEffect(() => {
    onMessageRef.current = onMessageEvent;
    onConversationRef.current = onConversationEvent;
    onConversationTagRef.current = onConversationTagEvent;
  });

  useEffect(() => {
    if (!enabled || !workspaceId) return;

    const supabase = createClient();
    // Realtime doesn't carry the x-workspace-id header, so scope each
    // subscription to the active workspace explicitly.
    const filter = `workspace_id=eq.${workspaceId}`;

    const channel = supabase
      .channel(`${channelName}:${workspaceId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "messages", filter },
        (payload) => {
          onMessageRef.current?.({
            eventType: payload.eventType as RealtimeEvent<Message>["eventType"],
            new: payload.new as Message,
            old: payload.old as Partial<Message>,
          });
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversations", filter },
        (payload) => {
          onConversationRef.current?.({
            eventType: payload.eventType as RealtimeEvent<Conversation>["eventType"],
            new: payload.new as Conversation,
            old: payload.old as Partial<Conversation>,
          });
        }
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "conversation_tags", filter },
        (payload) => {
          onConversationTagRef.current?.({
            eventType: "INSERT",
            new: payload.new as ConversationTagRow,
            old: {},
          });
        }
      )
      // DELETE events can't be filtered; under RLS they only carry the
      // row id, which the inbox matches against the ids it holds.
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "conversation_tags" },
        (payload) => {
          onConversationTagRef.current?.({
            eventType: "DELETE",
            new: {} as ConversationTagRow,
            old: payload.old as Partial<ConversationTagRow>,
          });
        }
      )
      .subscribe((status) => {
        setIsConnected(status === "SUBSCRIBED");
      });

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
      setIsConnected(false);
    };
  }, [channelName, enabled, workspaceId]);

  const unsubscribe = useCallback(() => {
    if (channelRef.current) {
      const supabase = createClient();
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
      setIsConnected(false);
    }
  }, []);

  return { isConnected, unsubscribe };
}

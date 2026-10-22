"use client";

import { useEffect, useRef, useState } from "react";
import { useRealtimeChanges } from "@/lib/realtime/client";
import { useWorkspace } from "@/hooks/use-workspace";
import type { Conversation } from "@/types";

interface Row {
  unread: number;
  /** Open and waiting for a person (AI / flow handed it over). */
  attention: boolean;
}

type CountRow = Pick<Conversation, "id" | "status" | "unread_count" | "needs_human_since">;

const rowOf = (c: Partial<CountRow>): Row => ({
  unread: c.unread_count ?? 0,
  attention: !!c.needs_human_since && c.status !== "closed",
});

/**
 * Inbox counters for the sidebar: conversations with unread inbound
 * messages, and conversations waiting for a person ("Atención requerida").
 *
 * Registers its own listener on the shared realtime stream, independent
 * of the inbox page's, so both can coexist without sharing state.
 */
export function useInboxCounts(): { unread: number; attention: number } {
  const [counts, setCounts] = useState({ unread: 0, attention: 0 });

  // Live local mirror by conversation id, so INSERT/UPDATE/DELETE events
  // adjust the totals without refetching.
  const rowsRef = useRef<Map<string, Row>>(new Map());
  const { workspace } = useWorkspace();
  const workspaceId = workspace?.id;

  const recompute = () => {
    let unread = 0;
    let attention = 0;
    for (const r of rowsRef.current.values()) {
      if (r.unread > 0) unread += 1;
      if (r.attention) attention += 1;
    }
    setCounts({ unread, attention });
  };

  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;

    // Initial load (GET /api/inbox/unread is scoped to the active workspace).
    (async () => {
      try {
        const res = await fetch("/api/inbox/unread", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { conversations?: CountRow[] };
        if (cancelled || !data.conversations) return;
        rowsRef.current = new Map(data.conversations.map((c) => [c.id, rowOf(c)]));
        recompute();
      } catch {
        // offline — realtime updates and the next mount catch up
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  useRealtimeChanges<Conversation>({
    workspaceId,
    tables: ["conversations"],
    onChange: (change) => {
      const map = rowsRef.current;
      if (change.eventType === "DELETE") {
        if (change.old.id) map.delete(change.old.id);
      } else {
        map.set(change.new.id, rowOf(change.new));
      }
      recompute();
    },
  });

  return counts;
}

/** Conversations with at least one unread inbound message. */
export function useTotalUnread(): number {
  return useInboxCounts().unread;
}

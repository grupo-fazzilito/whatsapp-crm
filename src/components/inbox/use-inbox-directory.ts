"use client";

import { useEffect, useMemo, useState } from "react";
import { useWorkspace } from "@/hooks/use-workspace";
import type { Profile } from "@/types";
import type { InboxChannel } from "./channel-badge";

export interface InboxAgent {
  id: string;
  name: string;
  enabled?: boolean;
}

export interface InboxDirectory {
  channels: InboxChannel[];
  channelsById: Map<string, InboxChannel>;
  /** AI agents by id (name only). */
  agentsById: Map<string, InboxAgent>;
  /** Active members of the workspace (assignable teammates). */
  members: Profile[];
  membersByUserId: Map<string, Profile>;
  loaded: boolean;
}

/**
 * Workspace-level lookups the inbox needs everywhere (channel badges, AI
 * agent names, assignee avatars). Loaded once per workspace.
 */
export function useInboxDirectory(): InboxDirectory {
  const { workspace } = useWorkspace();
  const workspaceId = workspace?.id;
  const [channels, setChannels] = useState<InboxChannel[]>([]);
  const [agents, setAgents] = useState<InboxAgent[]>([]);
  const [members, setMembers] = useState<Profile[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;

    (async () => {
      let data: { channels?: InboxChannel[]; agents?: InboxAgent[]; members?: Profile[] } = {};
      try {
        const res = await fetch("/api/inbox/directory", { cache: "no-store" });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
        data = body;
      } catch (error) {
        console.error("Failed to fetch inbox directory:", error instanceof Error ? error.message : error);
      }
      if (cancelled) return;

      setChannels(data.channels ?? []);
      setAgents(data.agents ?? []);
      setMembers(data.members ?? []);
      setLoaded(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  return useMemo(
    () => ({
      channels,
      channelsById: new Map(channels.map((c) => [c.id, c])),
      agentsById: new Map(agents.map((a) => [a.id, a])),
      members,
      membersByUserId: new Map(members.map((m) => [m.user_id, m])),
      loaded,
    }),
    [channels, agents, members, loaded],
  );
}

/** Two-letter initials for an avatar fallback. */
export function initialsOf(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
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
    const supabase = createClient();

    (async () => {
      const [channelsRes, agentsRes, membersRes] = await Promise.all([
        supabase
          .from("channels")
          .select("id, type, name, purpose, display_handle, status, ai_agent_id")
          .eq("workspace_id", workspaceId)
          .order("created_at", { ascending: true }),
        supabase
          .from("ai_agents")
          .select("id, name, enabled")
          .eq("workspace_id", workspaceId),
        supabase
          .from("workspace_members")
          .select("user_id")
          .eq("workspace_id", workspaceId)
          .eq("status", "active"),
      ]);
      if (cancelled) return;

      if (channelsRes.error) console.error("Failed to fetch channels:", channelsRes.error.message);
      if (agentsRes.error) console.error("Failed to fetch AI agents:", agentsRes.error.message);
      if (membersRes.error) console.error("Failed to fetch workspace members:", membersRes.error.message);

      setChannels((channelsRes.data as InboxChannel[]) ?? []);
      setAgents((agentsRes.data as InboxAgent[]) ?? []);

      const memberIds = (membersRes.data ?? []).map((m) => m.user_id as string);
      if (memberIds.length > 0) {
        const { data, error } = await supabase
          .from("profiles")
          .select("*")
          .in("user_id", memberIds)
          .order("full_name");
        if (cancelled) return;
        if (error) console.error("Failed to fetch profiles:", error.message);
        setMembers((data as Profile[]) ?? []);
      } else {
        setMembers([]);
      }
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

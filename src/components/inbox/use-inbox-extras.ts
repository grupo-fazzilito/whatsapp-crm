"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useWorkspace } from "@/hooks/use-workspace";
import type { Tag } from "@/types";
import type { QuickReply, Team } from "@/lib/inbox/types";

export interface TeamMemberInfo {
  user_id: string;
  role: string;
  available: boolean;
  full_name: string;
  email: string;
  avatar_url: string | null;
}

export interface InboxExtras {
  tags: Tag[];
  tagsById: Map<string, Tag>;
  /** Add a tag created inline (thread header) without a refetch. */
  addTag: (tag: Tag) => void;
  teams: Team[];
  teamsById: Map<string, Team>;
  /** Members with availability (for transfers). */
  teamMembers: TeamMemberInfo[];
  quickReplies: QuickReply[];
  reloadTeams: () => void;
  reloadQuickReplies: () => void;
}

/**
 * Workspace lookups for the "Bandeja Pro" features: tags, teams with
 * member availability, and the caller's quick replies.
 */
export function useInboxExtras(): InboxExtras {
  const { workspace } = useWorkspace();
  const workspaceId = workspace?.id;
  const [tags, setTags] = useState<Tag[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMemberInfo[]>([]);
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>([]);
  const [teamsToken, setTeamsToken] = useState(0);
  const [qrToken, setQrToken] = useState(0);

  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    fetch("/api/inbox/tags", { cache: "no-store" })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
        return (body.tags ?? []) as Tag[];
      })
      .catch((error) => {
        console.error("Failed to fetch tags:", error instanceof Error ? error.message : error);
        return [] as Tag[];
      })
      .then((data) => {
        if (!cancelled) setTags(data);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    fetch("/api/teams", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setTeams(data.teams ?? []);
        setTeamMembers(data.members ?? []);
      })
      .catch((err) => console.error("Failed to fetch teams:", err));
    return () => {
      cancelled = true;
    };
  }, [workspaceId, teamsToken]);

  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    fetch("/api/quick-replies", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setQuickReplies(data.quick_replies ?? []);
      })
      .catch((err) => console.error("Failed to fetch quick replies:", err));
    return () => {
      cancelled = true;
    };
  }, [workspaceId, qrToken]);

  const addTag = useCallback((tag: Tag) => {
    setTags((prev) =>
      prev.some((t) => t.id === tag.id)
        ? prev
        : [...prev, tag].sort((a, b) => a.name.localeCompare(b.name)),
    );
  }, []);
  const reloadTeams = useCallback(() => setTeamsToken((n) => n + 1), []);
  const reloadQuickReplies = useCallback(() => setQrToken((n) => n + 1), []);

  return useMemo(
    () => ({
      tags,
      tagsById: new Map(tags.map((t) => [t.id, t])),
      addTag,
      teams,
      teamsById: new Map(teams.map((t) => [t.id, t])),
      teamMembers,
      quickReplies,
      reloadTeams,
      reloadQuickReplies,
    }),
    [tags, addTag, teams, teamMembers, quickReplies, reloadTeams, reloadQuickReplies],
  );
}

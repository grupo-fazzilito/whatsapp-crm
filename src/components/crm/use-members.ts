'use client';

import { useEffect, useState } from 'react';
import { useWorkspace } from '@/hooks/use-workspace';

export interface MemberOption {
  /** auth user id (tasks.assignee_user_id). */
  userId: string;
  name: string;
  role: string;
}

interface MembersState {
  members: MemberOption[];
  meId: string | null;
}

interface ApiMember {
  user_id: string;
  role: string;
  status: string;
  profile: { full_name: string | null; email: string | null } | null;
}

// One request per workspace per page load, shared by every CRM widget.
const cache = new Map<string, Promise<MembersState>>();

function load(workspaceId: string): Promise<MembersState> {
  let p = cache.get(workspaceId);
  if (!p) {
    p = fetch('/api/workspaces/members', { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { members: ApiMember[]; me: { user_id: string } };
        return {
          meId: data.me?.user_id ?? null,
          members: (data.members ?? [])
            .filter((m) => m.status === 'active')
            .map((m) => ({
              userId: m.user_id,
              name: m.profile?.full_name || m.profile?.email || m.user_id.slice(0, 8),
              role: m.role,
            })),
        };
      })
      .catch((err) => {
        cache.delete(workspaceId);
        throw err;
      });
    cache.set(workspaceId, p);
  }
  return p;
}

/** Active members of the current workspace (for assignee pickers) + my user id. */
export function useMembers(): MembersState & { loading: boolean } {
  const { workspace } = useWorkspace();
  const [state, setState] = useState<MembersState & { loading: boolean }>({ members: [], meId: null, loading: true });
  const wsId = workspace?.id;

  useEffect(() => {
    if (!wsId) return;
    let cancelled = false;
    load(wsId)
      .then((s) => {
        if (!cancelled) setState({ ...s, loading: false });
      })
      .catch(() => {
        if (!cancelled) setState((prev) => ({ ...prev, loading: false }));
      });
    return () => {
      cancelled = true;
    };
  }, [wsId]);

  return state;
}

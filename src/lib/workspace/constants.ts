// Cookie that stores the active workspace id. Readable from the browser
// on purpose: it is not a secret (RLS still checks membership) and the
// browser Supabase client forwards it as WORKSPACE_HEADER.
export const WORKSPACE_COOKIE = 'ws_id'

// Header PostgREST exposes to RLS through `request.headers`; see
// public.active_ws() in supabase/migrations/021_workspaces.sql.
export const WORKSPACE_HEADER = 'x-workspace-id'

export type WorkspaceRole = 'owner' | 'admin' | 'agent'

const ROLE_RANK: Record<WorkspaceRole, number> = { owner: 3, admin: 2, agent: 1 }

export function hasRole(role: WorkspaceRole | null | undefined, min: WorkspaceRole): boolean {
  return !!role && ROLE_RANK[role] >= ROLE_RANK[min]
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(v: string | null | undefined): v is string {
  return !!v && UUID_RE.test(v)
}

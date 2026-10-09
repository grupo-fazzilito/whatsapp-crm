import 'server-only'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/db/prisma'
import { tenantDb, type TenantDb } from '@/lib/db/tenant'
import { WORKSPACE_COOKIE, hasRole, isUuid, type WorkspaceRole } from './constants'
import type { Workspace } from './types'

export interface WorkspaceContext {
  user: User
  workspace: Workspace
  role: WorkspaceRole
  /** Prisma client confined to `workspace` (use this). */
  db: TenantDb
  /** @deprecated Cookie client scoped (RLS) to `workspace`; removed with Supabase. */
  supabase: SupabaseClient
}

export interface Membership {
  role: WorkspaceRole
  workspace: Workspace
}

/** Every active workspace the user belongs to, oldest first. */
export async function listMemberships(userId: string): Promise<Membership[]> {
  // Platform client: memberships of one user across workspaces.
  const data = await prisma.workspace_members.findMany({
    where: { user_id: userId, status: 'active' },
    select: { role: true, created_at: true, workspaces: true },
    orderBy: { created_at: 'asc' },
  })
  return data
    .filter((m) => m.workspaces)
    .map((m) => ({ role: m.role as WorkspaceRole, workspace: m.workspaces as unknown as Workspace }))
}

/**
 * Resolves the signed-in user and their active workspace (cookie, falling
 * back to their first membership). Returns null when signed out or when
 * the user has no workspace at all.
 */
export async function getWorkspaceContext(): Promise<WorkspaceContext | null> {
  const authClient = await createClient(null)
  const {
    data: { user },
  } = await authClient.auth.getUser()
  if (!user) return null

  const memberships = await listMemberships(user.id)
  if (memberships.length === 0) return null

  const cookieStore = await cookies()
  const wanted = cookieStore.get(WORKSPACE_COOKIE)?.value
  const active =
    (isUuid(wanted) && memberships.find((m) => m.workspace.id === wanted)) || memberships[0]

  return {
    user,
    workspace: active.workspace,
    role: active.role,
    db: tenantDb(active.workspace.id),
    supabase: await createClient(active.workspace.id),
  }
}

type Guarded =
  | { ok: true; ctx: WorkspaceContext }
  | { ok: false; response: NextResponse }

/** Route-handler guard: 401 when signed out, 403 below `minRole`. */
export async function requireWorkspace(minRole: WorkspaceRole = 'agent'): Promise<Guarded> {
  const ctx = await getWorkspaceContext()
  if (!ctx) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  if (!hasRole(ctx.role, minRole)) {
    return { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { ok: true, ctx }
}

export function workspaceCookieOptions() {
  return {
    path: '/',
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    httpOnly: false,
    maxAge: 60 * 60 * 24 * 365,
  }
}

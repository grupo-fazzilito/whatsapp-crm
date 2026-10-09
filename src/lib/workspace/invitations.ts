import 'server-only'
import crypto from 'crypto'
import { prisma } from '@/lib/db/prisma'
import { tenantDb } from '@/lib/db/tenant'

export function newInviteToken(): { token: string; hash: string } {
  const token = crypto.randomBytes(32).toString('base64url')
  return { token, hash: hashInviteToken(token) }
}

export function hashInviteToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

export interface PendingInvitation {
  id: string
  workspace_id: string
  email: string
  role: 'admin' | 'agent'
  workspace_name: string
}

/** Valid (unexpired, unaccepted) invitation for a raw token, or null. */
export async function findPendingInvitation(token: string): Promise<PendingInvitation | null> {
  if (!token || token.length < 20) return null
  // Platform client: the token is all we know until the invitation is found.
  const data = await prisma.workspace_invitations
    .findUnique({
      where: { token_hash: hashInviteToken(token) },
      select: { id: true, workspace_id: true, email: true, role: true, expires_at: true, accepted_at: true, workspaces: { select: { name: true } } },
    })
    .catch((err) => {
      console.error('[invitations] lookup failed:', err instanceof Error ? err.message : err)
      return null
    })
  if (!data || data.accepted_at || new Date(data.expires_at) < new Date()) return null
  const ws = data.workspaces as { name: string } | null
  return {
    id: data.id,
    workspace_id: data.workspace_id,
    email: data.email,
    role: data.role as PendingInvitation['role'],
    workspace_name: ws?.name ?? '',
  }
}

/** Adds the user to the workspace and marks the invitation accepted. */
export async function acceptInvitation(inv: PendingInvitation, userId: string): Promise<void> {
  const db = tenantDb(inv.workspace_id)
  await db.workspace_members.createMany({
    data: [{ workspace_id: inv.workspace_id, user_id: userId, role: inv.role, status: 'active' }],
    skipDuplicates: true,
  })
  await db.workspace_invitations
    .updateMany({ where: { id: inv.id }, data: { accepted_at: new Date() } })
    .catch((err) => console.error('[invitations] mark accepted failed:', err instanceof Error ? err.message : err))
}

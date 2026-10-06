import 'server-only'
import crypto from 'crypto'
import { supabaseAdmin } from '@/lib/supabase/admin'

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
  const { data } = await supabaseAdmin()
    .from('workspace_invitations')
    .select('id, workspace_id, email, role, expires_at, accepted_at, workspace:workspaces(name)')
    .eq('token_hash', hashInviteToken(token))
    .maybeSingle()
  if (!data || data.accepted_at || new Date(data.expires_at) < new Date()) return null
  const ws = data.workspace as unknown as { name: string } | null
  return {
    id: data.id,
    workspace_id: data.workspace_id,
    email: data.email,
    role: data.role,
    workspace_name: ws?.name ?? '',
  }
}

/** Adds the user to the workspace and marks the invitation accepted. */
export async function acceptInvitation(inv: PendingInvitation, userId: string): Promise<void> {
  const db = supabaseAdmin()
  const { error } = await db
    .from('workspace_members')
    .upsert(
      { workspace_id: inv.workspace_id, user_id: userId, role: inv.role, status: 'active' },
      { onConflict: 'workspace_id,user_id', ignoreDuplicates: true },
    )
  if (error) throw error
  await db.from('workspace_invitations').update({ accepted_at: new Date().toISOString() }).eq('id', inv.id)
}

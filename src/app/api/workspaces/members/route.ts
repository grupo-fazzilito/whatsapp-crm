import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { requireWorkspace } from '@/lib/workspace/context'
import { hasRole, isUuid, type WorkspaceRole } from '@/lib/workspace/constants'

const ROLES: WorkspaceRole[] = ['owner', 'admin', 'agent']

// GET — members of the active workspace with their profile.
export async function GET() {
  const g = await requireWorkspace('agent')
  if (!g.ok) return g.response
  const db = supabaseAdmin()
  const { data: members, error } = await db
    .from('workspace_members')
    .select('id, workspace_id, user_id, role, status, created_at')
    .eq('workspace_id', g.ctx.workspace.id)
    .order('created_at', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const ids = (members ?? []).map((m) => m.user_id)
  const { data: profiles } = ids.length
    ? await db.from('profiles').select('user_id, full_name, email, avatar_url').in('user_id', ids)
    : { data: [] }
  const byUser = new Map((profiles ?? []).map((p) => [p.user_id, p]))

  return NextResponse.json({
    members: (members ?? []).map((m) => ({ ...m, profile: byUser.get(m.user_id) ?? null })),
    me: { user_id: g.ctx.user.id, role: g.ctx.role },
  })
}

async function ownerCount(workspaceId: string) {
  const { count } = await supabaseAdmin()
    .from('workspace_members')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .eq('role', 'owner')
    .eq('status', 'active')
  return count ?? 0
}

// PATCH {memberId, role?, status?} — admins manage agents; only owners
// grant or revoke owner/admin. The last owner can't be demoted.
export async function PATCH(req: NextRequest) {
  const g = await requireWorkspace('admin')
  if (!g.ok) return g.response
  const { memberId, role, status } = await req.json().catch(() => ({}))
  if (!isUuid(memberId)) return NextResponse.json({ error: 'Invalid member' }, { status: 400 })
  if (role !== undefined && !ROLES.includes(role)) return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
  if (status !== undefined && !['active', 'disabled'].includes(status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
  }

  const db = supabaseAdmin()
  const { data: target } = await db
    .from('workspace_members')
    .select('id, user_id, role, status')
    .eq('id', memberId)
    .eq('workspace_id', g.ctx.workspace.id)
    .maybeSingle()
  if (!target) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

  const touchesPrivileged = target.role !== 'agent' || (role && role !== 'agent')
  if (touchesPrivileged && !hasRole(g.ctx.role, 'owner')) {
    return NextResponse.json({ error: 'Only owners can change admins or owners' }, { status: 403 })
  }
  const losesOwner = target.role === 'owner' && ((role && role !== 'owner') || status === 'disabled')
  if (losesOwner && (await ownerCount(g.ctx.workspace.id)) <= 1) {
    return NextResponse.json({ error: 'A workspace needs at least one owner' }, { status: 400 })
  }

  const { error } = await db
    .from('workspace_members')
    .update({ ...(role ? { role } : {}), ...(status ? { status } : {}) })
    .eq('id', memberId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

// DELETE ?id= — remove a member (or leave, when it's yourself).
export async function DELETE(req: NextRequest) {
  const g = await requireWorkspace('agent')
  if (!g.ok) return g.response
  const memberId = req.nextUrl.searchParams.get('id')
  if (!isUuid(memberId)) return NextResponse.json({ error: 'Invalid member' }, { status: 400 })

  const db = supabaseAdmin()
  const { data: target } = await db
    .from('workspace_members')
    .select('id, user_id, role')
    .eq('id', memberId)
    .eq('workspace_id', g.ctx.workspace.id)
    .maybeSingle()
  if (!target) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

  const isSelf = target.user_id === g.ctx.user.id
  if (!isSelf) {
    if (!hasRole(g.ctx.role, 'admin')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (target.role !== 'agent' && !hasRole(g.ctx.role, 'owner')) {
      return NextResponse.json({ error: 'Only owners can remove admins or owners' }, { status: 403 })
    }
  }
  if (target.role === 'owner' && (await ownerCount(g.ctx.workspace.id)) <= 1) {
    return NextResponse.json({ error: 'A workspace needs at least one owner' }, { status: 400 })
  }

  // Unassign their open conversations so nothing is stranded.
  await db
    .from('conversations')
    .update({ assigned_agent_id: null })
    .eq('workspace_id', g.ctx.workspace.id)
    .eq('assigned_agent_id', target.user_id)

  const { error } = await db.from('workspace_members').delete().eq('id', memberId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

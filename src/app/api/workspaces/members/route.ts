import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import type { TenantDb } from '@/lib/db/tenant'
import { requireWorkspace } from '@/lib/workspace/context'
import { hasRole, isUuid, type WorkspaceRole } from '@/lib/workspace/constants'

const ROLES: WorkspaceRole[] = ['owner', 'admin', 'agent']

// GET — members of the active workspace with their profile.
export async function GET() {
  const g = await requireWorkspace('agent')
  if (!g.ok) return g.response
  let members
  try {
    members = await g.ctx.db.workspace_members.findMany({
      select: { id: true, workspace_id: true, user_id: true, role: true, status: true, created_at: true },
      orderBy: { created_at: 'asc' },
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }

  const ids = members.map((m) => m.user_id)
  // Platform client: profiles of this workspace's members only.
  const profiles = ids.length
    ? await prisma.profiles
        .findMany({ where: { user_id: { in: ids } }, select: { user_id: true, full_name: true, email: true, avatar_url: true } })
        .catch(() => [])
    : []
  const byUser = new Map((profiles ?? []).map((p) => [p.user_id, p]))

  return NextResponse.json({
    members: (members ?? []).map((m) => ({ ...m, profile: byUser.get(m.user_id) ?? null })),
    me: { user_id: g.ctx.user.id, role: g.ctx.role },
  })
}

async function ownerCount(db: TenantDb) {
  return db.workspace_members.count({ where: { role: 'owner', status: 'active' } }).catch(() => 0)
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

  const db = g.ctx.db
  const target = await db.workspace_members
    .findFirst({ where: { id: memberId }, select: { id: true, user_id: true, role: true, status: true } })
    .catch(() => null)
  if (!target) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

  const touchesPrivileged = target.role !== 'agent' || (role && role !== 'agent')
  if (touchesPrivileged && !hasRole(g.ctx.role, 'owner')) {
    return NextResponse.json({ error: 'Only owners can change admins or owners' }, { status: 403 })
  }
  const losesOwner = target.role === 'owner' && ((role && role !== 'owner') || status === 'disabled')
  if (losesOwner && (await ownerCount(g.ctx.db)) <= 1) {
    return NextResponse.json({ error: 'A workspace needs at least one owner' }, { status: 400 })
  }

  try {
    await db.workspace_members.updateMany({
      where: { id: memberId },
      data: { ...(role ? { role } : {}), ...(status ? { status } : {}) },
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}

// DELETE ?id= — remove a member (or leave, when it's yourself).
export async function DELETE(req: NextRequest) {
  const g = await requireWorkspace('agent')
  if (!g.ok) return g.response
  const memberId = req.nextUrl.searchParams.get('id')
  if (!isUuid(memberId)) return NextResponse.json({ error: 'Invalid member' }, { status: 400 })

  const db = g.ctx.db
  const target = await db.workspace_members
    .findFirst({ where: { id: memberId }, select: { id: true, user_id: true, role: true } })
    .catch(() => null)
  if (!target) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

  const isSelf = target.user_id === g.ctx.user.id
  if (!isSelf) {
    if (!hasRole(g.ctx.role, 'admin')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (target.role !== 'agent' && !hasRole(g.ctx.role, 'owner')) {
      return NextResponse.json({ error: 'Only owners can remove admins or owners' }, { status: 403 })
    }
  }
  if (target.role === 'owner' && (await ownerCount(g.ctx.db)) <= 1) {
    return NextResponse.json({ error: 'A workspace needs at least one owner' }, { status: 400 })
  }

  // Unassign their open conversations so nothing is stranded.
  await db.conversations
    .updateMany({ where: { assigned_agent_id: target.user_id }, data: { assigned_agent_id: null } })
    .catch((err) => console.error('[members] unassign failed:', err instanceof Error ? err.message : String(err)))

  try {
    await db.workspace_members.deleteMany({ where: { id: memberId } })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}

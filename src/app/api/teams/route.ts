import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'
import { parseInboxSettings } from '@/lib/inbox/assignment'
import { activeMemberIds } from '@/lib/inbox/server'
import { prisma } from '@/lib/db/prisma'
import { isPrismaError, pgErrorCode } from '@/lib/db/errors'

/**
 * GET /api/teams → {
 *   teams: [{id, name, description, member_ids}],
 *   members: [{user_id, role, available, full_name, email, avatar_url}],
 *   settings: {auto_assign, default_team_id},
 *   me: {user_id, available}
 * }
 * POST /api/teams { name, description?, member_ids? } (admins) → { team }
 */
export async function GET() {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { db, user, workspace } = guard.ctx

  let teamRows, linkRows, memberRows
  try {
    ;[teamRows, linkRows, memberRows] = await Promise.all([
      db.teams.findMany({
        select: { id: true, workspace_id: true, name: true, description: true, created_at: true },
        where: { workspace_id: workspace.id },
        orderBy: { name: 'asc' },
      }),
      db.team_members.findMany({ select: { team_id: true, user_id: true }, where: { workspace_id: workspace.id } }).catch(() => null),
      db.workspace_members.findMany({
        select: { user_id: true, role: true, available: true, last_assigned_at: true },
        where: { workspace_id: workspace.id, status: 'active' },
      }),
    ])
  } catch (error) {
    console.error('[teams] list failed:', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'Failed to load teams' }, { status: 500 })
  }
  const ids = memberRows.map((m) => m.user_id)
  // profiles has no workspace_id: platform client, limited to this workspace's members.
  const profiles = ids.length
    ? await prisma.profiles
        .findMany({ select: { user_id: true, full_name: true, email: true, avatar_url: true }, where: { user_id: { in: ids } } })
        .catch(() => null)
    : []
  const byId = new Map((profiles ?? []).map((p) => [p.user_id as string, p]))

  const links = linkRows ?? []
  const teams = teamRows.map((t) => ({
    ...t,
    member_ids: links.filter((l) => l.team_id === t.id).map((l) => l.user_id as string),
  }))
  const members = memberRows
    .map((m) => {
      const p = byId.get(m.user_id as string)
      return {
        user_id: m.user_id,
        role: m.role,
        available: m.available !== false,
        full_name: (p?.full_name as string) ?? '',
        email: (p?.email as string) ?? '',
        avatar_url: (p?.avatar_url as string | null) ?? null,
      }
    })
    .sort((a, b) => (a.full_name || a.email).localeCompare(b.full_name || b.email))
  const mine = members.find((m) => m.user_id === user.id)

  return NextResponse.json({
    teams,
    members,
    settings: parseInboxSettings(workspace.settings),
    me: { user_id: user.id, available: mine?.available ?? true },
  })
}

export async function POST(request: Request) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const { db, workspace } = guard.ctx

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 80) : ''
  if (!name) return NextResponse.json({ error: 'name_required' }, { status: 400 })
  const description = typeof body?.description === 'string' ? body.description.trim().slice(0, 300) || null : null

  let team
  try {
    team = await db.teams.create({
      data: { workspace_id: workspace.id, name, description },
      select: { id: true, workspace_id: true, name: true, description: true, created_at: true },
    })
  } catch (error) {
    if (isPrismaError(error, 'P2002') || pgErrorCode(error) === '23505') return NextResponse.json({ error: 'name_taken' }, { status: 409 })
    console.error('[teams] create failed:', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'Failed to create team' }, { status: 500 })
  }

  const wanted = Array.isArray(body?.member_ids) ? body!.member_ids.filter((x): x is string => typeof x === 'string' && isUuid(x)) : []
  const memberIds = await activeMemberIds(workspace.id, wanted)
  if (memberIds.length) {
    try {
      await db.team_members.createMany({ data: memberIds.map((uid) => ({ workspace_id: workspace.id, team_id: team.id, user_id: uid })) })
    } catch (mErr) {
      console.error('[teams] members insert failed:', mErr instanceof Error ? mErr.message : mErr)
    }
  }
  return NextResponse.json({ team: { ...team, member_ids: memberIds } })
}

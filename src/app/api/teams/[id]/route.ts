import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'
import { activeMemberIds } from '@/lib/inbox/server'
import { isPrismaError, pgErrorCode } from '@/lib/db/errors'

/**
 * PATCH  /api/teams/[id] { name?, description?, member_ids? } (admins)
 *   member_ids replaces the team's members. → { team }
 * DELETE /api/teams/[id] (admins) — conversations keep working (team_id
 *   becomes null). → { ok }
 */
const TEAM_SELECT = { id: true, workspace_id: true, name: true, description: true, created_at: true } as const

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const { db, workspace } = guard.ctx
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })

  const update: Record<string, unknown> = {}
  if ('name' in body) {
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : ''
    if (!name) return NextResponse.json({ error: 'name_required' }, { status: 400 })
    update.name = name
  }
  if ('description' in body) {
    update.description = typeof body.description === 'string' ? body.description.trim().slice(0, 300) || null : null
  }

  let team: Record<string, unknown> | null = null
  if (Object.keys(update).length) {
    try {
      const rows = await db.teams.updateManyAndReturn({
        where: { id, workspace_id: workspace.id },
        data: update,
        select: TEAM_SELECT,
      })
      team = rows[0] ?? null
    } catch (error) {
      if (isPrismaError(error, 'P2002') || pgErrorCode(error) === '23505') return NextResponse.json({ error: 'name_taken' }, { status: 409 })
      console.error('[teams] update failed:', error instanceof Error ? error.message : error)
      return NextResponse.json({ error: 'Failed to update team' }, { status: 500 })
    }
  } else {
    team = await db.teams.findFirst({ select: TEAM_SELECT, where: { id, workspace_id: workspace.id } }).catch(() => null)
  }
  if (!team) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (Array.isArray(body.member_ids)) {
    const wanted = body.member_ids.filter((x): x is string => typeof x === 'string' && isUuid(x))
    const memberIds = await activeMemberIds(workspace.id, wanted)
    const current = await db.team_members
      .findMany({ select: { user_id: true }, where: { team_id: id, workspace_id: workspace.id } })
      .catch(() => null)
    const have = (current ?? []).map((m) => m.user_id)
    const toRemove = have.filter((u) => !memberIds.includes(u))
    const toAdd = memberIds.filter((u) => !have.includes(u))
    if (toRemove.length) {
      try {
        await db.team_members.deleteMany({ where: { team_id: id, workspace_id: workspace.id, user_id: { in: toRemove } } })
      } catch (error) {
        console.error('[teams] member removal failed:', error instanceof Error ? error.message : error)
      }
    }
    if (toAdd.length) {
      try {
        await db.team_members.createMany({ data: toAdd.map((uid) => ({ workspace_id: workspace.id, team_id: id, user_id: uid })) })
      } catch (error) {
        console.error('[teams] member insert failed:', error instanceof Error ? error.message : error)
      }
    }
  }
  const links = await db.team_members.findMany({ select: { user_id: true }, where: { team_id: id, workspace_id: workspace.id } }).catch(() => null)
  return NextResponse.json({ team: { ...team, member_ids: (links ?? []).map((l) => l.user_id) } })
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const { db, workspace } = guard.ctx
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  let deleted: number
  try {
    deleted = (await db.teams.deleteMany({ where: { id, workspace_id: workspace.id } })).count
  } catch (error) {
    console.error('[teams] delete failed:', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'Failed to delete team' }, { status: 500 })
  }
  if (!deleted) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}

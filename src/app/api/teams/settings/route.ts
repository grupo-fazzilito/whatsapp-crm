import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'
import type { Prisma } from '@/generated/prisma/client'
import { parseInboxSettings } from '@/lib/inbox/assignment'
import { teamOf } from '@/lib/inbox/server'

/**
 * PATCH /api/teams/settings { auto_assign?: 'off'|'round_robin', default_team_id?: string|null }
 * (admins) Updates workspaces.settings.inbox. → { settings }
 */
export async function PATCH(request: Request) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const { db, workspace } = guard.ctx
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })

  // Fresh read so concurrent edits of other settings keys aren't lost.
  const ws = await db.workspaces.findFirst({ select: { settings: true }, where: { id: workspace.id } }).catch(() => null)
  const settings = (ws?.settings ?? {}) as Record<string, unknown>
  const current = parseInboxSettings(settings)
  const next = { ...((settings.inbox as Record<string, unknown>) ?? {}), ...current }

  if ('auto_assign' in body) {
    if (body.auto_assign !== 'off' && body.auto_assign !== 'round_robin') {
      return NextResponse.json({ error: "auto_assign must be 'off' or 'round_robin'" }, { status: 400 })
    }
    next.auto_assign = body.auto_assign
  }
  if ('default_team_id' in body) {
    const teamId = body.default_team_id
    if (teamId === null || teamId === '') next.default_team_id = null
    else if (typeof teamId === 'string' && isUuid(teamId) && (await teamOf(workspace.id, teamId))) next.default_team_id = teamId
    else return NextResponse.json({ error: 'default_team_id must be a team of this workspace' }, { status: 400 })
  }

  try {
    await db.workspaces.updateMany({ where: { id: workspace.id }, data: { settings: { ...settings, inbox: next } as Prisma.InputJsonValue } })
  } catch (error) {
    console.error('[teams/settings] update failed:', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 })
  }
  return NextResponse.json({ settings: parseInboxSettings({ inbox: next }) })
}

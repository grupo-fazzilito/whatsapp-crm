import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'

/**
 * GET   /api/notifications?limit=30 → { notifications, unread }
 *   The caller's notifications in the active workspace, newest first.
 * PATCH /api/notifications { ids: string[] } | { all: true } → { ok, unread }
 *   Marks notifications as read.
 */
export async function GET(request: Request) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { db, user, workspace } = guard.ctx
  const raw = Number(new URL(request.url).searchParams.get('limit') ?? 30)
  const limit = Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 1), 100) : 30

  const mine = { workspace_id: workspace.id, user_id: user.id }
  const [list, unread] = await Promise.allSettled([
    db.notifications.findMany({ where: mine, orderBy: { created_at: 'desc' }, take: limit }),
    db.notifications.count({ where: { ...mine, read_at: null } }),
  ])
  if (list.status === 'rejected') {
    console.error('[notifications] list failed:', list.reason instanceof Error ? list.reason.message : list.reason)
    return NextResponse.json({ error: 'Failed to load notifications' }, { status: 500 })
  }
  return NextResponse.json({ notifications: list.value, unread: unread.status === 'fulfilled' ? unread.value : 0 })
}

export async function PATCH(request: Request) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { db, user, workspace } = guard.ctx
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })

  const unreadMine = { workspace_id: workspace.id, user_id: user.id, read_at: null }
  let ids: string[] | null = null
  if (body.all !== true) {
    ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === 'string' && isUuid(x)).slice(0, 200) : []
    if (!ids.length) return NextResponse.json({ error: 'ids or all is required' }, { status: 400 })
  }
  try {
    await db.notifications.updateMany({
      where: { ...unreadMine, ...(ids ? { id: { in: ids } } : {}) },
      data: { read_at: new Date().toISOString() },
    })
  } catch (err) {
    console.error('[notifications] mark read failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Failed to update notifications' }, { status: 500 })
  }
  const count = await db.notifications.count({ where: unreadMine }).catch(() => 0)
  return NextResponse.json({ ok: true, unread: count })
}

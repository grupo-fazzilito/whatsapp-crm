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
  const { supabase, user, workspace } = guard.ctx
  const raw = Number(new URL(request.url).searchParams.get('limit') ?? 30)
  const limit = Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 1), 100) : 30

  const [list, unread] = await Promise.all([
    supabase
      .from('notifications')
      .select('*')
      .eq('workspace_id', workspace.id)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(limit),
    supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspace.id)
      .eq('user_id', user.id)
      .is('read_at', null),
  ])
  if (list.error) {
    console.error('[notifications] list failed:', list.error.message)
    return NextResponse.json({ error: 'Failed to load notifications' }, { status: 500 })
  }
  return NextResponse.json({ notifications: list.data ?? [], unread: unread.count ?? 0 })
}

export async function PATCH(request: Request) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { supabase, user, workspace } = guard.ctx
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })

  let q = supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('workspace_id', workspace.id)
    .eq('user_id', user.id)
    .is('read_at', null)
  if (body.all !== true) {
    const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === 'string' && isUuid(x)).slice(0, 200) : []
    if (!ids.length) return NextResponse.json({ error: 'ids or all is required' }, { status: 400 })
    q = q.in('id', ids)
  }
  const { error } = await q
  if (error) {
    console.error('[notifications] mark read failed:', error.message)
    return NextResponse.json({ error: 'Failed to update notifications' }, { status: 500 })
  }
  const { count } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspace.id)
    .eq('user_id', user.id)
    .is('read_at', null)
  return NextResponse.json({ ok: true, unread: count ?? 0 })
}

import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { hasRole, isUuid } from '@/lib/workspace/constants'
import { parseQuickReplyInput } from '@/lib/inbox/quick-replies'
import { isPrismaError } from '@/lib/db/errors'
import { removeObjects } from '@/lib/storage'
import type { WorkspaceRole } from '@/lib/workspace/constants'

/** Rows the caller may change (was RLS): own personal replies; admins also shared ones. */
function manageable(userId: string, role: WorkspaceRole) {
  return hasRole(role, 'admin')
    ? { OR: [{ is_shared: true }, { created_by: userId }] }
    : { is_shared: false, created_by: userId }
}

/**
 * PATCH  /api/quick-replies/[id] { shortcut?, title?, body?, attachments?, is_shared? }
 * DELETE /api/quick-replies/[id]
 * Authors manage their personal replies; admins manage shared ones (RLS
 * used to enforce it; now `manageable`). Only admins can make a reply shared.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { db, role, user, workspace } = guard.ctx
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  const parsed = parseQuickReplyInput(body, workspace.id, true)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  if (parsed.value.is_shared === true && !hasRole(role, 'admin')) {
    return NextResponse.json({ error: 'only_admins_share' }, { status: 403 })
  }
  if (Object.keys(parsed.value).length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })

  let data
  try {
    const updated = await db.quick_replies.updateManyAndReturn({ where: { id, ...manageable(user.id, role) }, data: parsed.value as never })
    data = updated[0] ?? null
  } catch (err) {
    if (isPrismaError(err, 'P2002')) return NextResponse.json({ error: 'shortcut_taken' }, { status: 409 })
    console.error('[quick-replies] update failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Failed to update quick reply' }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ quick_reply: data })
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { db, workspace, role, user } = guard.ctx
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  let data: { id: string; attachments: unknown }[]
  try {
    const where = { id, ...manageable(user.id, role) }
    const rows = await db.quick_replies.findMany({ where, select: { id: true, attachments: true } })
    const { count } = rows.length ? await db.quick_replies.deleteMany({ where }) : { count: 0 }
    data = count ? rows : []
  } catch (err) {
    console.error('[quick-replies] delete failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Failed to delete quick reply' }, { status: 500 })
  }
  if (!data.length) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Drop the stored files too (best effort).
  const paths = ((data[0].attachments ?? []) as { path?: string }[])
    .map((a) => a.path)
    .filter((p): p is string => typeof p === 'string' && p.startsWith(`${workspace.id}/quick-replies/`))
  if (paths.length) {
    await removeObjects('attachments', paths).catch((err) =>
      console.error('[quick-replies] file cleanup failed:', err instanceof Error ? err.message : err),
    )
  }
  return NextResponse.json({ ok: true })
}

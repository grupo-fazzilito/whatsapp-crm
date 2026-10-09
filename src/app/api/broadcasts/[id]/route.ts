import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'

/**
 * GET    /api/broadcasts/[id] → { broadcast, recipients } — recipients newest
 *        first, each with its contact (any member). 404 when not in the workspace.
 * DELETE /api/broadcasts/[id] — admins. Recipients cascade.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { db } = guard.ctx
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Broadcast not found' }, { status: 404 })

  try {
    const broadcast = await db.broadcasts.findFirst({ where: { id } })
    if (!broadcast) return NextResponse.json({ error: 'Broadcast not found' }, { status: 404 })
    const rows = await db.broadcast_recipients.findMany({
      where: { broadcast_id: id },
      include: { contacts: true },
      orderBy: { created_at: 'desc' },
    })
    const recipients = rows.map(({ contacts, ...r }) => ({ ...r, contact: contacts }))
    return NextResponse.json({ broadcast, recipients })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Broadcast not found' }, { status: 404 })
  try {
    await guard.ctx.db.broadcasts.deleteMany({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}

import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'
import { deleteFailedMessage } from '@/lib/inbox/queries'

/** DELETE /api/inbox/messages/[id] → { ok } — only messages whose send failed (retry). */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  try {
    if (!(await deleteFailedMessage(guard.ctx.db, id))) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[inbox] delete message failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Failed to delete message' }, { status: 500 })
  }
}

import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'
import { markConversationRead } from '@/lib/inbox/queries'

/** POST /api/inbox/conversations/[id]/read → { ok } — resets unread_count to 0. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  try {
    if (!(await markConversationRead(guard.ctx.db, id))) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[inbox] mark read failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Failed to update conversation' }, { status: 500 })
  }
}

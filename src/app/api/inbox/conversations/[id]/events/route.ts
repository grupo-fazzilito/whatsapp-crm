import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'
import { listEvents } from '@/lib/inbox/queries'

/** GET /api/inbox/conversations/[id]/events → { events } (timeline, oldest first, ≤ 500) */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  try {
    return NextResponse.json({ events: await listEvents(guard.ctx.db, id) })
  } catch (err) {
    console.error('[inbox] events failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Failed to load events' }, { status: 500 })
  }
}

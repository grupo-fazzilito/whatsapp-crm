import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { listUnreadCounts } from '@/lib/inbox/queries'

/** GET /api/inbox/unread → { conversations: [{id, unread_count}] } */
export async function GET() {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  try {
    return NextResponse.json({ conversations: await listUnreadCounts(guard.ctx.db) })
  } catch (err) {
    console.error('[inbox] unread failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Failed to load unread counts' }, { status: 500 })
  }
}

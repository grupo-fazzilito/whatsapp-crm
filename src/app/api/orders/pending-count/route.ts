import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { pendingOrderCount } from '@/lib/orders/list'

/** GET /api/orders/pending-count — any member. → { count } of new (pending) orders. */
export async function GET() {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  try {
    return NextResponse.json({ count: await pendingOrderCount(guard.ctx.db) })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}

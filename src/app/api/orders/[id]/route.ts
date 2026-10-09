import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'
import { getOrderDetail } from '@/lib/orders/list'

/** GET /api/orders/[id] — any member. → { order } with items and events; 404 when missing. */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { id } = await ctx.params
  if (!isUuid(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const order = await getOrderDetail(guard.ctx.db, id)
  if (!order) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ order })
}

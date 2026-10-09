import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'
import { contactOrders } from '@/lib/inbox/queries'

/**
 * GET /api/inbox/contacts/[id]/orders → { orders (last 5), cart: {id, cart_items: [{id, quantity, product, variant}]} | null }
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  try {
    return NextResponse.json(await contactOrders(guard.ctx.db, id))
  } catch (err) {
    console.error('[inbox] contact orders failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Failed to load orders' }, { status: 500 })
  }
}

import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'
import { createManualOrder, type ManualItemInput } from '@/lib/orders/manual'
import type { Fulfillment } from '@/lib/orders/texts'

/**
 * POST /api/orders — any member creates an order by hand.
 * Body: {contact_id, items:[{product_id, variant_id?, quantity}], fulfillment,
 *        address?, address_reference?, notes?}
 * Prices and names come from the current catalog. Returns {order:{id, number}}.
 */
const FULFILLMENTS = new Set<Fulfillment>(['pickup', 'delivery', 'dine_in'])
const MAX_ITEMS = 50

const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)

export async function POST(request: Request) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { user, workspace } = guard.ctx

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })

  const contactId = body.contact_id
  if (typeof contactId !== 'string' || !isUuid(contactId)) return NextResponse.json({ error: 'contact_not_found' }, { status: 400 })
  const fulfillment = body.fulfillment
  if (typeof fulfillment !== 'string' || !FULFILLMENTS.has(fulfillment as Fulfillment)) {
    return NextResponse.json({ error: 'fulfillment_not_allowed' }, { status: 400 })
  }
  if (!Array.isArray(body.items) || body.items.length === 0 || body.items.length > MAX_ITEMS) {
    return NextResponse.json({ error: 'empty' }, { status: 400 })
  }
  const items: ManualItemInput[] = []
  for (const raw of body.items) {
    const it = raw as Record<string, unknown> | null
    const quantity = Number(it?.quantity)
    if (!it || typeof it.product_id !== 'string' || !isUuid(it.product_id) || !Number.isFinite(quantity) || quantity < 1) {
      return NextResponse.json({ error: 'invalid_item' }, { status: 400 })
    }
    const variantId = it.variant_id
    if (variantId != null && (typeof variantId !== 'string' || !isUuid(variantId))) {
      return NextResponse.json({ error: 'invalid_item' }, { status: 400 })
    }
    items.push({ product_id: it.product_id, variant_id: (variantId as string | null) ?? null, quantity })
  }

  try {
    const result = await createManualOrder({
      workspace,
      userId: user.id,
      contactId,
      items,
      fulfillment: fulfillment as Fulfillment,
      address: str(body.address, 300),
      addressReference: str(body.address_reference, 300),
      notes: str(body.notes, 1000),
    })
    if (!result.ok) return NextResponse.json({ error: result.error, detail: result.detail }, { status: 400 })
    return NextResponse.json({ order: result.order }, { status: 201 })
  } catch (err) {
    console.error('[orders] manual create failed:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

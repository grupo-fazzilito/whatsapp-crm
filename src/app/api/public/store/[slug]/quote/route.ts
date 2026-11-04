import { NextResponse } from 'next/server'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { parseItems } from '@/lib/store/checkout'
import { loadCheckoutOptions, loadStore, priceItems } from '@/lib/store/server'
import { quoteShipping } from '@/lib/store/shipping'
import { visitorIp } from '@/lib/store/request'

type Ctx = { params: Promise<{ slug: string }> }

/**
 * POST /api/public/store/:slug/quote { items } → the cart as the server
 * prices it: { subtotal, weight_kg, shipping: [{ id, fee | null }] } (fee
 * null = the order is too heavy for that profile), or { error, name?, available? }.
 */
export async function POST(request: Request, { params }: Ctx) {
  const { slug } = await params
  const limit = checkRateLimit(`store-quote:${visitorIp(request)}`, { limit: 60, windowMs: 60_000 })
  if (!limit.success) return rateLimitResponse(limit)
  const store = await loadStore(slug)
  if (!store) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const items = parseItems(body?.items)
  if (!items) return NextResponse.json({ error: 'items' }, { status: 400 })
  const priced = await priceItems(store.workspace, items)
  if (!priced.ok) return NextResponse.json(priced, { status: 409 })
  const { shipping } = await loadCheckoutOptions(store.workspace.id)
  return NextResponse.json({
    subtotal: priced.subtotal,
    weight_kg: priced.weightKg,
    shipping: shipping.map((p) => {
      const q = quoteShipping(p, priced.subtotal, priced.weightKg)
      return { id: p.id, fee: q.ok ? q.fee : null, free_reason: q.ok ? q.freeReason : null, on_delivery: q.ok && !!q.onDelivery }
    }),
  })
}

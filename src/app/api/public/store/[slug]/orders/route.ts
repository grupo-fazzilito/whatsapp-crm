import { NextResponse } from 'next/server'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { parseCheckoutInput } from '@/lib/store/checkout'
import { loadStore, orderPagePath, placeStoreOrder } from '@/lib/store/server'
import { visitorIp } from '@/lib/store/request'

type Ctx = { params: Promise<{ slug: string }> }

/**
 * POST /api/public/store/:slug/orders — the checkout form (see
 * lib/store/checkout.ts). Prices, stock and shipping are computed here.
 * → 201 { number, total, url } | 400 { error: <field> } | 409 { error, name?, available? }
 */
export async function POST(request: Request, { params }: Ctx) {
  const { slug } = await params
  const ip = visitorIp(request)
  const limit = checkRateLimit(`store-order:${ip}`, { limit: 8, windowMs: 10 * 60_000 })
  if (!limit.success) return rateLimitResponse(limit)

  const store = await loadStore(slug)
  if (!store || store.preview) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  // Honeypot: people never see this field.
  if (typeof body?.website === 'string' && body.website.trim()) return NextResponse.json({ error: 'items' }, { status: 400 })
  const parsed = parseCheckoutInput(body, store.dialCode)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  try {
    const result = await placeStoreOrder(store, parsed.input)
    if (!result.ok) return NextResponse.json(result, { status: 409 })
    return NextResponse.json({ number: result.number, total: result.total, url: orderPagePath(store.workspace.slug, result.token) }, { status: 201 })
  } catch (err) {
    console.error('[store] order failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'failed' }, { status: 500 })
  }
}

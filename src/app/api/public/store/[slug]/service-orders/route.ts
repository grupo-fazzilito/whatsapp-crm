import { NextResponse } from 'next/server'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { isUuid } from '@/lib/workspace/constants'
import { loadStore, orderPagePath } from '@/lib/store/server'
import { loadStoreServices, placeServiceOrder } from '@/lib/store/services'
import { parseServiceCheckout } from '@/lib/store/service-checkout'
import { visitorIp } from '@/lib/store/request'

type Ctx = { params: Promise<{ slug: string }> }

/**
 * POST /api/public/store/:slug/service-orders — buy one service, booking its
 * appointment when the service asks for it (see lib/store/service-checkout.ts).
 * → 201 { number, total, url } | 400 { error } | 409 { error, alternatives?, missing? }
 */
export async function POST(request: Request, { params }: Ctx) {
  const { slug } = await params
  const limit = checkRateLimit(`store-order:${visitorIp(request)}`, { limit: 8, windowMs: 10 * 60_000 })
  if (!limit.success) return rateLimitResponse(limit)
  const store = await loadStore(slug)
  if (!store || store.preview) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (typeof body?.website === 'string' && body.website.trim()) return NextResponse.json({ error: 'service' }, { status: 400 })
  const serviceId = typeof body?.service_id === 'string' && isUuid(body.service_id) ? body.service_id : null
  const service = serviceId ? (await loadStoreServices(store.workspace, serviceId))[0] : null
  if (!service) return NextResponse.json({ error: 'service' }, { status: 400 })
  const parsed = parseServiceCheckout(body, store.dialCode, service.booking === 'schedule')
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  try {
    const result = await placeServiceOrder(store, parsed.input)
    if (!result.ok) return NextResponse.json(result, { status: 409 })
    return NextResponse.json({ number: result.number, total: result.total, url: orderPagePath(store.workspace.slug, result.token) }, { status: 201 })
  } catch (err) {
    console.error('[store] service order failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'failed' }, { status: 500 })
  }
}

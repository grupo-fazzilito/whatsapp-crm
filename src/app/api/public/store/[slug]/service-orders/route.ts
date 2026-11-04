import { NextResponse } from 'next/server'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { isUuid } from '@/lib/workspace/constants'
import { loadStore, orderPagePath } from '@/lib/store/server'
import { loadStoreServices, placeServiceOrder, type ProofFile } from '@/lib/store/services'
import { parseServiceCheckout, PROOF_MAX_BYTES, proofImageType } from '@/lib/store/service-checkout'
import { visitorIp } from '@/lib/store/request'

type Ctx = { params: Promise<{ slug: string }> }

/**
 * POST /api/public/store/:slug/service-orders — buy one service, booking its
 * appointment when the service asks for it (see lib/store/service-checkout.ts).
 * JSON, or multipart with `data` (the same JSON) and `proof` (the payment
 * proof image, required for Yape, Plin and transfers).
 * → 201 { number, total, url } | 400 { error } | 409 { error, alternatives?, missing? }
 */
export async function POST(request: Request, { params }: Ctx) {
  const { slug } = await params
  const limit = checkRateLimit(`store-order:${visitorIp(request)}`, { limit: 8, windowMs: 10 * 60_000 })
  if (!limit.success) return rateLimitResponse(limit)
  const store = await loadStore(slug)
  if (!store || store.preview) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  let body: Record<string, unknown> | null = null
  let proof: ProofFile | null = null
  if ((request.headers.get('content-type') ?? '').startsWith('multipart/form-data')) {
    const form = await request.formData().catch(() => null)
    const data = form?.get('data')
    try {
      body = typeof data === 'string' ? (JSON.parse(data) as Record<string, unknown>) : null
    } catch {
      body = null
    }
    const file = form?.get('proof')
    if (file instanceof File && file.size > 0) {
      if (file.size > PROOF_MAX_BYTES) return NextResponse.json({ error: 'proof_size' }, { status: 400 })
      const bytes = Buffer.from(await file.arrayBuffer())
      const contentType = proofImageType(bytes)
      if (!contentType) return NextResponse.json({ error: 'proof_type' }, { status: 400 })
      proof = { body: bytes, contentType }
    }
  } else {
    body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  }
  if (typeof body?.website === 'string' && body.website.trim()) return NextResponse.json({ error: 'service' }, { status: 400 })
  const serviceId = typeof body?.service_id === 'string' && isUuid(body.service_id) ? body.service_id : null
  const service = serviceId ? (await loadStoreServices(store.workspace, serviceId))[0] : null
  if (!service) return NextResponse.json({ error: 'service' }, { status: 400 })
  const parsed = parseServiceCheckout(body, store.dialCode, service.booking === 'schedule')
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  try {
    const result = await placeServiceOrder(store, parsed.input, proof)
    if (!result.ok) return NextResponse.json(result, { status: 409 })
    return NextResponse.json({ number: result.number, total: result.total, url: orderPagePath(store.workspace.slug, result.token) }, { status: 201 })
  } catch (err) {
    console.error('[store] service order failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'failed' }, { status: 500 })
  }
}

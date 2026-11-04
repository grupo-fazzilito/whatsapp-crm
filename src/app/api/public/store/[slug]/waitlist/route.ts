import { NextResponse, after } from 'next/server'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { loadStore } from '@/lib/store/server'
import { visitorIp } from '@/lib/store/request'
import { parseWaitlistInput } from '@/lib/store/waitlist-input'
import { joinWaitlist } from '@/lib/waitlist/server'
import { ensureWaitlistTemplate } from '@/lib/waitlist/template'

type Ctx = { params: Promise<{ slug: string }> }

/**
 * POST /api/public/store/:slug/waitlist — "Notify me when available" on a
 * sold-out product. { product_id, variant_id?, name?, phone }
 * → 201 { ok, wa_url } (wa.me link with the customer's message to the business, or null)
 * | 400 { error: product | phone } | 409 { error: off | in_stock } | 403 { error: preview }
 */
export async function POST(request: Request, { params }: Ctx) {
  const { slug } = await params
  const limit = checkRateLimit(`store-waitlist:${visitorIp(request)}`, { limit: 10, windowMs: 10 * 60_000 })
  if (!limit.success) return rateLimitResponse(limit)
  const store = await loadStore(slug)
  if (!store) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (store.preview) return NextResponse.json({ error: 'preview' }, { status: 403 })
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  // Honeypot field bots fill in.
  if (typeof body?.website === 'string' && body.website.trim()) return NextResponse.json({ error: 'product' }, { status: 400 })
  const parsed = parseWaitlistInput(body, store.dialCode)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  try {
    const result = await joinWaitlist(store, parsed.input)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.error === 'product' ? 400 : 409 })
    // "Notificar llegada de stock" left ready for the business to send to Meta.
    after(() => ensureWaitlistTemplate(store.workspace.id))
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    console.error('[waitlist] join failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'failed' }, { status: 500 })
  }
}

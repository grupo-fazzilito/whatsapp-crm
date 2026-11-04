import { NextResponse } from 'next/server'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { isUuid } from '@/lib/workspace/constants'
import { loadStore } from '@/lib/store/server'
import { loadStoreServices, serviceSlots } from '@/lib/store/services'
import { visitorIp } from '@/lib/store/request'

type Ctx = { params: Promise<{ slug: string; id: string }> }

/**
 * GET /api/public/store/:slug/services/:id/slots?staff=<id>&date=YYYY-MM-DD
 * → { days: [{ date, open }], times: ['10:00', …] } (times only with date).
 */
export async function GET(request: Request, { params }: Ctx) {
  const { slug, id } = await params
  const limit = checkRateLimit(`store-slots:${visitorIp(request)}`, { limit: 120, windowMs: 60_000 })
  if (!limit.success) return rateLimitResponse(limit)
  const store = await loadStore(slug)
  if (!store || !isUuid(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const service = (await loadStoreServices(store.workspace, id))[0]
  if (!service || service.booking !== 'schedule') return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const sp = new URL(request.url).searchParams
  const staff = sp.get('staff')
  const staffId = staff && service.staff.some((s) => s.id === staff) ? staff : null
  const slots = await serviceSlots(store.workspace, service, staffId, sp.get('date'))
  return NextResponse.json(slots, { headers: { 'Cache-Control': 'no-store' } })
}

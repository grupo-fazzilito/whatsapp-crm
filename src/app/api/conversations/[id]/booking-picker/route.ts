import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'
import { getPreset, resolveIndustry } from '@/lib/industries'
import { loadCalendlyLinks } from '@/lib/integrations/calendly/booking'
import { startBookingPicker } from '@/lib/bookings/picker'

type Params = { params: Promise<{ id: string }> }

/**
 * GET  /api/conversations/[id]/booking-picker (members) → what the "Send schedule" dialog needs:
 *      { bookings_on, needs_staff, needs_product, calendly_service_ids, google_staff_ids }
 * POST /api/conversations/[id]/booking-picker { service_id?, staff_id?, product_id? } (members)
 *      → { status: 'waiting' } | 409 { error: 'window_closed' | 'bookings_off' | 'no_slots' }
 *      Sends the customer the booking picker (they book by tapping, without the AI).
 */
export async function GET(_request: Request, { params }: Params) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid conversation id' }, { status: 400 })
  const { db, workspace } = guard.ctx
  const { modules } = resolveIndustry(workspace.industry, workspace.settings)
  const preset = getPreset(workspace.industry)
  const [links, google] = await Promise.all([
    loadCalendlyLinks(workspace.id).catch(() => ({})),
    db.calendar_connections.findMany({ select: { staff_id: true }, where: { status: 'active' } }).catch(() => []),
  ])
  return NextResponse.json({
    bookings_on: modules.bookings,
    needs_staff: modules.staff && preset.bookingNeedsStaff,
    needs_product: preset.bookingFields.some((f) => f.type === 'product' && f.required),
    calendly_service_ids: Object.keys(links),
    google_staff_ids: google.map((g) => g.staff_id).filter(Boolean),
  })
}

export async function POST(request: Request, { params }: Params) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid conversation id' }, { status: 400 })
  const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>
  const ref = (k: string) => {
    const v = body[k]
    return typeof v === 'string' && isUuid(v) ? v : null
  }
  const { workspace, user } = guard.ctx
  const r = await startBookingPicker({
    workspaceId: workspace.id,
    conversationId: id,
    origin: 'inbox',
    userId: user.id,
    preset: { service_id: ref('service_id'), staff_id: ref('staff_id'), product_id: ref('product_id') },
  })
  if (r.status === 'error') {
    if (r.reason === 'not_found') return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    return NextResponse.json({ error: r.reason }, { status: 409 })
  }
  return NextResponse.json({ status: r.status })
}

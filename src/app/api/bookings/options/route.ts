import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { errorResponse } from '@/lib/business/setup-server'

/**
 * GET /api/bookings/options[?products=1] (members) — what the bookings screen needs besides bookings:
 *   → { staff: active staff + service_ids, services, hours, products } (products only when asked; [] on error)
 */
export async function GET(request: Request) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { db } = guard.ctx
  const withProducts = new URL(request.url).searchParams.get('products') === '1'
  try {
    const [staff, links, services, hours] = await Promise.all([
      db.staff.findMany({ where: { is_active: true }, orderBy: { name: 'asc' } }),
      db.staff_services.findMany({ select: { staff_id: true, service_id: true } }),
      db.services.findMany({ select: { id: true, name: true, duration_minutes: true, price: true, is_active: true }, orderBy: { name: 'asc' } }),
      db.business_hours.findMany({ select: { day_name: true, opening_time: true, closing_time: true, is_closed: true, break_start: true, break_end: true } }),
    ])
    const byStaff = new Map<string, string[]>()
    for (const l of links) byStaff.set(l.staff_id, [...(byStaff.get(l.staff_id) ?? []), l.service_id])
    const products = withProducts
      ? await db.products.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' }, take: 500 }).catch(() => [])
      : []
    return NextResponse.json({
      staff: staff.map((s) => ({ ...s, service_ids: byStaff.get(s.id) ?? [] })),
      services,
      hours,
      products,
    })
  } catch (err) {
    return errorResponse('bookings/options', err)
  }
}

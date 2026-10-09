import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { invalidateBusinessContext } from '@/lib/ai/context'
import { parseBooking } from '@/lib/business/setup-input'
import { badRequest, errorResponse, readBody } from '@/lib/business/setup-server'
import { assertBookingRefs, BOOKING_INCLUDE, bookingOut } from '@/lib/bookings/manual'
import type { Prisma } from '@/generated/prisma/client'

const MAX_BOOKINGS = 2000
const DAY = /^\d{4}-\d{2}-\d{2}$/

/**
 * GET  /api/bookings (members) → { bookings } newest first (max 2000) with contact, staff and service.
 * GET  /api/bookings?date=YYYY-MM-DD&active=1 → { bookings } of that day still pending/confirmed
 *      (id, staff_id, booking_date, booking_time, duration_minutes, status, party_size) — for availability.
 * POST /api/bookings { contact_id, booking_date, booking_time, customer_name?, service_id?, staff_id?, product_id?,
 *      duration_minutes?, party_size?, custom_fields?, notes?, status? } (members) → { id }
 */
export async function GET(request: Request) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { db } = guard.ctx
  const sp = new URL(request.url).searchParams
  const date = sp.get('date')
  try {
    if (date !== null) {
      if (!DAY.test(date)) return badRequest('Invalid date')
      const bookings = await db.bookings.findMany({
        select: { id: true, staff_id: true, booking_date: true, booking_time: true, duration_minutes: true, status: true, party_size: true },
        where: { booking_date: date, ...(sp.get('active') === '1' ? { status: { in: ['pending', 'confirmed'] } } : {}) },
      })
      return NextResponse.json({ bookings })
    }
    const rows = await db.bookings.findMany({
      include: BOOKING_INCLUDE,
      orderBy: [{ booking_date: 'desc' }, { booking_time: 'desc' }],
      take: MAX_BOOKINGS,
    })
    return NextResponse.json({ bookings: rows.map(bookingOut) })
  } catch (err) {
    return errorResponse('bookings', err)
  }
}

export async function POST(request: Request) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const body = await readBody(request)
  if (!body) return badRequest('Invalid JSON body')
  const { db, workspace } = guard.ctx
  try {
    const data = parseBooking(body, false)
    await assertBookingRefs(db, data)
    const row = await db.bookings.create({
      data: { ...(data as Prisma.bookingsUncheckedCreateInput), workspace_id: workspace.id, source: 'manual' },
      select: { id: true },
    })
    invalidateBusinessContext(workspace.id)
    return NextResponse.json({ id: row.id })
  } catch (err) {
    return errorResponse('bookings', err)
  }
}

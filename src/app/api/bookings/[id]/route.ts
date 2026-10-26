import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { invalidateBusinessContext } from '@/lib/ai/context'
import { parseBooking } from '@/lib/business/setup-input'
import { badRequest, errorResponse, idParam, notFound, readBody } from '@/lib/business/setup-server'
import { assertBookingRefs } from '@/lib/bookings/manual'
import { createTranslator } from '@/i18n/translate'

type Params = { params: Promise<{ id: string }> }

/**
 * PATCH  /api/bookings/[id] { …any booking field (e.g. just status) } (members) → { id }
 *   A new date or time resets the reminder flags. Calendly bookings can't move (Calendly has no
 *   reschedule API): 409, cancel it and book again.
 * DELETE /api/bookings/[id] (members) → { ok }
 */
export async function PATCH(request: Request, { params }: Params) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const id = await idParam(params)
  if (!id) return badRequest('Invalid id')
  const body = await readBody(request)
  if (!body) return badRequest('Invalid JSON body')
  const { db, workspace } = guard.ctx
  try {
    const data = parseBooking(body, true)
    const current = await db.bookings.findFirst({ where: { id }, select: { booking_date: true, booking_time: true, calendly_event_uri: true } })
    if (!current) return notFound()
    await assertBookingRefs(db, data)
    const whenChanged =
      ('booking_date' in data && data.booking_date !== current.booking_date) ||
      ('booking_time' in data && data.booking_time !== String(current.booking_time).slice(0, 5))
    if (whenChanged && current.calendly_event_uri) {
      const t = createTranslator(workspace.locale === 'en' ? 'en' : 'es')
      return NextResponse.json({ error: t('bookings.calendlyManual.reschedule') }, { status: 409 })
    }
    const { count } = await db.bookings.updateMany({
      where: { id },
      data: {
        ...data,
        ...(whenChanged ? { reminder_24h_sent: false, reminder_4h_sent: false, reminder_2h_sent: false } : {}),
        updated_at: new Date(),
      },
    })
    if (!count) return notFound()
    invalidateBusinessContext(workspace.id)
    return NextResponse.json({ id })
  } catch (err) {
    return errorResponse('bookings', err)
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const id = await idParam(params)
  if (!id) return badRequest('Invalid id')
  try {
    const { count } = await guard.ctx.db.bookings.deleteMany({ where: { id } })
    if (!count) return notFound()
    invalidateBusinessContext(guard.ctx.workspace.id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return errorResponse('bookings', err)
  }
}

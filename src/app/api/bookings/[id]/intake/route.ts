import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { badRequest, errorResponse, idParam, notFound, readBody } from '@/lib/business/setup-server'

type Params = { params: Promise<{ id: string }> }

const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)

/**
 * GET  /api/bookings/[id]/intake (members) → { intake | null }
 *   When the booking has none, the customer's latest unattached intake (collected by
 *   the AI before the booking existed) is attached to it.
 * POST /api/bookings/[id]/intake { symptoms, allergies?, current_medications?, medical_history? } (members) → { intake }
 */
export async function GET(_request: Request, { params }: Params) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const id = await idParam(params)
  if (!id) return badRequest('Invalid id')
  const { db } = guard.ctx
  try {
    const booking = await db.bookings.findFirst({ where: { id }, select: { contact_id: true } })
    if (!booking) return notFound()
    let intake = await db.patient_intake.findFirst({ where: { booking_id: id } })
    if (!intake && booking.contact_id) {
      const loose = await db.patient_intake.findFirst({
        where: { contact_id: booking.contact_id, booking_id: null },
        orderBy: { created_at: 'desc' },
      })
      if (loose) {
        await db.patient_intake.updateMany({ where: { id: loose.id }, data: { booking_id: id } }).catch(() => null)
        intake = (await db.patient_intake.findFirst({ where: { id: loose.id } })) ?? loose
      }
    }
    return NextResponse.json({ intake })
  } catch (err) {
    return errorResponse('bookings/intake', err)
  }
}

export async function POST(request: Request, { params }: Params) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const id = await idParam(params)
  if (!id) return badRequest('Invalid id')
  const body = await readBody(request)
  if (!body) return badRequest('Invalid JSON body')
  const symptoms = text(body.symptoms, 5000)
  if (!symptoms) return badRequest('symptoms is required')
  const { db, workspace } = guard.ctx
  try {
    const booking = await db.bookings.findFirst({ where: { id }, select: { contact_id: true } })
    if (!booking) return notFound()
    const intake = await db.patient_intake.create({
      data: {
        workspace_id: workspace.id,
        contact_id: booking.contact_id,
        booking_id: id,
        symptoms,
        allergies: text(body.allergies, 5000),
        current_medications: text(body.current_medications, 5000),
        medical_history: text(body.medical_history, 5000),
        urgency_level: 'routine',
        collected_via: 'dashboard',
      },
    })
    return NextResponse.json({ intake })
  } catch (err) {
    return errorResponse('bookings/intake', err)
  }
}

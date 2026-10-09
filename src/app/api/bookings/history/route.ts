import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/business/setup-input'
import { badRequest, errorResponse } from '@/lib/business/setup-server'

/**
 * GET /api/bookings/history?contact_id=<id>[&intakes=1] (members)
 *   Customer's intake forms (when asked) and feedback, newest first. → { intakes, feedback }
 */
export async function GET(request: Request) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const sp = new URL(request.url).searchParams
  const contactId = sp.get('contact_id')
  if (!isUuid(contactId)) return badRequest('Invalid contact_id')
  const { db } = guard.ctx
  try {
    const [intakes, feedback] = await Promise.all([
      sp.get('intakes') === '1' ? db.patient_intake.findMany({ where: { contact_id: contactId }, orderBy: { created_at: 'desc' } }) : Promise.resolve([]),
      db.feedback.findMany({
        select: { id: true, rating: true, feedback_text: true, created_at: true },
        where: { contact_id: contactId },
        orderBy: { created_at: 'desc' },
      }),
    ])
    return NextResponse.json({ intakes, feedback })
  } catch (err) {
    return errorResponse('bookings/history', err)
  }
}

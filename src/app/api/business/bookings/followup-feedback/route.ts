import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { notifyFromRequest } from '@/lib/bookings/server'

/** POST {bookingId, type: 'feedback' | 'followup'} — post-visit message. */
export async function POST(request: Request) {
  const guard = await requireWorkspace()
  if (!guard.ok) return guard.response
  const { workspace: ws, db } = guard.ctx
  const body = await request.json().catch(() => ({}))
  const type = body.type
  if (type !== 'feedback' && type !== 'followup') {
    return NextResponse.json({ error: 'type ("feedback" | "followup") is required' }, { status: 400 })
  }
  return notifyFromRequest(
    ws,
    body.bookingId ?? body.appointmentId,
    () => type,
    async (b) => {
      const flag = type === 'feedback' ? { feedback_sent: true } : { followup_sent: true }
      // A failed flag update never failed the request.
      await db.bookings.updateMany({ where: { id: b.id }, data: flag }).catch(() => {})
    },
  )
}

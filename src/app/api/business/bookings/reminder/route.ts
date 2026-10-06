import { requireWorkspace } from '@/lib/workspace/context'
import { notifyFromRequest } from '@/lib/bookings/server'

/** POST {bookingId} — send a manual reminder (active bookings only). */
export async function POST(request: Request) {
  const guard = await requireWorkspace()
  if (!guard.ok) return guard.response
  const body = await request.json().catch(() => ({}))
  return notifyFromRequest(guard.ctx.workspace, body.bookingId ?? body.appointmentId, (b) =>
    b.status === 'confirmed' || b.status === 'pending' ? 'reminder' : null,
  )
}

import { requireWorkspace } from '@/lib/workspace/context'
import { notifyFromRequest } from '@/lib/bookings/server'
import type { BookingMessageKind } from '@/lib/bookings/messages'

const BY_STATUS: Record<string, BookingMessageKind> = {
  confirmed: 'confirmation',
  completed: 'completed',
  cancelled: 'cancelled',
}

/** POST {bookingId} — tell the customer about the booking's current status. */
export async function POST(request: Request) {
  const guard = await requireWorkspace()
  if (!guard.ok) return guard.response
  const body = await request.json().catch(() => ({}))
  return notifyFromRequest(guard.ctx.workspace, body.bookingId ?? body.appointmentId, (b) => BY_STATUS[b.status] ?? null)
}

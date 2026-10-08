import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'
import { processEventDeletions, syncBooking, syncPendingBookings } from '@/lib/integrations/google/sync'

/**
 * POST {bookingId?} — push booking changes to the staff's Google Calendar
 * now instead of waiting for the cron. Called by the booking UI after a
 * create / edit / status change / delete; without bookingId it flushes
 * the workspace's pending changes.
 */
export async function POST(request: Request) {
  const guard = await requireWorkspace()
  if (!guard.ok) return guard.response
  const ws = guard.ctx.workspace
  const body = await request.json().catch(() => ({}))
  const bookingId = body.bookingId ?? body.booking_id
  if (bookingId !== undefined && !isUuid(bookingId)) return NextResponse.json({ error: 'invalid bookingId' }, { status: 400 })
  if (bookingId) {
    const state = await syncBooking(bookingId, ws.id)
    return NextResponse.json({ state })
  }
  const [pending, deletions] = await Promise.all([syncPendingBookings(ws.id, 25), processEventDeletions(25, ws.id)])
  return NextResponse.json({ ...pending, deleted: deletions.deleted })
}

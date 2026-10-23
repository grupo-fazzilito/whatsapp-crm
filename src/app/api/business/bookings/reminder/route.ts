import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { bookingMessageText, loadBookingBundle } from '@/lib/bookings/server'
import { sendBookingReminder } from '@/lib/bookings/reminder-send'
import { createTranslator } from '@/i18n/translate'

/**
 * POST {bookingId} — send a manual reminder (active bookings only). Same
 * rules as the automatic ones: text inside the reply window, the WhatsApp
 * template outside it, one credit when sent. 409 { error } (readable) when
 * it can't go out.
 */
export async function POST(request: Request) {
  const guard = await requireWorkspace()
  if (!guard.ok) return guard.response
  const { workspace } = guard.ctx
  const body = await request.json().catch(() => ({}))
  const id = body.bookingId ?? body.appointmentId
  const b = typeof id === 'string' ? await loadBookingBundle(workspace.id, id) : null
  if (!b?.workspace) return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
  if (b.status !== 'confirmed' && b.status !== 'pending') return NextResponse.json({ success: true, skipped: true, status: b.status })
  const res = await sendBookingReminder(b, b.workspace, 'manual', bookingMessageText('reminder', b, b.workspace))
  if (!res.ok) {
    const t = createTranslator(workspace.locale === 'en' ? 'en' : 'es')
    return NextResponse.json({ error: t(`bookings.reminders.error.${res.reason}`) }, { status: 409 })
  }
  return NextResponse.json({ success: true, kind: 'reminder', status: b.status })
}

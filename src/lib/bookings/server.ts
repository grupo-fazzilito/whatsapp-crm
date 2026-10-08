import 'server-only'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { sendToContact } from '@/lib/messaging/conversations'
import { safeTimeZone } from '@/lib/ai/time'
import type { Workspace } from '@/lib/workspace/types'
import { buildBookingMessage, type BookingMessageKind } from './messages'
import { selectDueReminders, utcDate, type ReminderCandidate } from './reminders'
import { afterViewingReminder } from '@/lib/real-estate/leads/visits'

type WorkspaceLite = Pick<Workspace, 'id' | 'name' | 'industry' | 'locale' | 'timezone' | 'settings'>

export interface BookingBundle {
  id: string
  workspace_id: string
  contact_id: string | null
  booking_date: string
  booking_time: string
  status: string
  customer_name: string | null
  party_size: number | null
  feedback_sent: boolean | null
  followup_sent: boolean | null
  reminder_24h_sent: boolean | null
  reminder_4h_sent: boolean | null
  reminder_2h_sent: boolean | null
  contact: { id: string; name: string | null } | null
  staff: { name: string | null } | null
  service: { name: string | null } | null
  workspace: WorkspaceLite | null
}

const BUNDLE_SELECT = `
  id, workspace_id, contact_id, booking_date, booking_time, status, customer_name, party_size,
  feedback_sent, followup_sent, reminder_24h_sent, reminder_4h_sent, reminder_2h_sent,
  contact:contacts(id, name),
  staff:staff(name),
  service:services(name),
  workspace:workspaces(id, name, industry, locale, timezone, settings)
`

/** Shared secret check for cron endpoints (open in dev when unset). */
export function cronGuard(request: Request): NextResponse | null {
  const expected = process.env.AUTOMATION_CRON_SECRET
  const supplied = request.headers.get('x-cron-secret') || new URL(request.url).searchParams.get('secret')
  if (!expected) {
    if (process.env.NODE_ENV === 'development') return null
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }
  if (supplied !== expected) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return null
}

/** One booking of the workspace with what the customer messages need. */
export async function loadBookingBundle(workspaceId: string, bookingId: string): Promise<BookingBundle | null> {
  const { data } = await supabaseAdmin()
    .from('bookings')
    .select(BUNDLE_SELECT)
    .eq('workspace_id', workspaceId)
    .eq('id', bookingId)
    .maybeSingle()
  return (data as unknown as BookingBundle) ?? null
}

export function bookingMessageText(kind: BookingMessageKind, b: BookingBundle, ws: WorkspaceLite): string {
  return buildBookingMessage(kind, {
    locale: ws.locale === 'en' ? 'en' : 'es',
    industry: ws.industry,
    settings: ws.settings,
    businessName: ws.name,
    customerName: b.customer_name || b.contact?.name,
    staffName: b.staff?.name,
    serviceName: b.service?.name,
    date: b.booking_date,
    time: b.booking_time,
    partySize: b.party_size,
  })
}

export interface NotifyResult {
  ok: boolean
  messageId: string
  /** Delivery failed but dev mode pretends it worked. */
  simulated?: boolean
  error?: string
}

/**
 * Sends a booking message to the customer on their usual conversation.
 * Local dev usually has no live channel: failures are reported as
 * simulated successes there so the UI flow stays usable.
 */
export async function notifyBooking(
  kind: BookingMessageKind,
  b: BookingBundle,
  ws: WorkspaceLite,
  metadata?: Record<string, unknown>,
): Promise<NotifyResult> {
  if (!b.contact_id) return { ok: false, messageId: '', error: 'Booking has no contact' }
  const sent = await sendToContact({
    workspaceId: ws.id,
    contactId: b.contact_id,
    content: { type: 'text', text: bookingMessageText(kind, b, ws) },
    metadata: { source: 'booking', kind, booking_id: b.id, ...metadata },
  })
  if (sent.status !== 'failed') return { ok: true, messageId: sent.externalId ?? sent.messageId }
  if (process.env.NODE_ENV === 'development') {
    console.warn(`[bookings] dev send failure (${kind}, ${b.id}): ${sent.error}. Simulating success.`)
    return { ok: true, simulated: true, messageId: `sandbox-${Date.now()}`, error: sent.error }
  }
  return { ok: false, messageId: '', error: sent.error ?? 'send failed' }
}

/** Common body of the agent-triggered message routes. */
export async function notifyFromRequest(
  workspace: Workspace,
  bookingId: unknown,
  pick: (b: BookingBundle) => BookingMessageKind | null,
  after?: (b: BookingBundle) => Promise<void>,
): Promise<NextResponse> {
  if (typeof bookingId !== 'string' || !bookingId) {
    return NextResponse.json({ error: 'bookingId is required' }, { status: 400 })
  }
  const b = await loadBookingBundle(workspace.id, bookingId)
  if (!b) return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
  const kind = pick(b)
  if (!kind) return NextResponse.json({ success: true, skipped: true, status: b.status })
  const res = await notifyBooking(kind, b, workspace)
  if (!res.ok) return NextResponse.json({ error: `Send failed: ${res.error}` }, { status: 502 })
  if (after) await after(b)
  return NextResponse.json({ success: true, kind, status: b.status, message_id: res.messageId, simulated: !!res.simulated })
}

/**
 * Sends due reminders for every workspace. Each booking is judged in its
 * workspace's time zone. Returns how many were sent / skipped.
 */
export async function processBookingReminders(now = new Date()): Promise<{ processed: number; skipped: number }> {
  const db = supabaseAdmin()
  // Local dates differ from UTC by at most ~14h: a ±1 day window around
  // the UTC date covers "the next 24h" in every zone.
  const { data, error } = await db
    .from('bookings')
    .select(BUNDLE_SELECT)
    .in('status', ['confirmed', 'pending'])
    .gte('booking_date', utcDate(now, -1))
    .lte('booking_date', utcDate(now, 2))
    .or('reminder_24h_sent.eq.false,reminder_4h_sent.eq.false,reminder_2h_sent.eq.false')
  if (error) throw new Error(`Failed to fetch bookings: ${error.message}`)

  const rows = ((data ?? []) as unknown as BookingBundle[])
    .filter((b) => b.workspace)
    .map((b) => ({ ...b, timeZone: safeTimeZone(b.workspace!.timezone) }) satisfies ReminderCandidate & BookingBundle)

  let processed = 0
  let skipped = 0
  for (const due of selectDueReminders(rows, now)) {
    const b = due.booking
    const res = await notifyBooking(`reminder_${due.kind}`, b, b.workspace!, { reminder: due.kind })
    if (!res.ok) {
      console.error(`[bookings] reminder ${due.kind} failed for ${b.id}:`, res.error)
      skipped++
      continue // flags stay false so the next run retries
    }
    const { error: upErr } = await db.from('bookings').update(due.updates).eq('id', b.id).eq('workspace_id', b.workspace_id)
    if (upErr) console.error(`[bookings] reminder flags update failed for ${b.id}:`, upErr.message)
    // Real-estate viewings: the property's map pin with the last reminder.
    if (b.workspace?.industry === 'real_estate') await afterViewingReminder(b.workspace_id, b.id, due.hoursUntil)
    processed++
  }
  return { processed, skipped }
}

/**
 * Post-visit messages: feedback request ~1 day after a booking is marked
 * completed, check-in ~1 week after.
 */
export async function processBookingFollowUps(now = new Date()): Promise<{ feedbackSent: number; followUpSent: number; skipped: number }> {
  const db = supabaseAdmin()
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString()

  const [feedbackRes, followRes] = await Promise.all([
    db
      .from('bookings')
      .select(BUNDLE_SELECT)
      .eq('status', 'completed')
      .or('feedback_sent.is.null,feedback_sent.eq.false')
      .gte('updated_at', hoursAgo(28))
      .lte('updated_at', hoursAgo(20)),
    db
      .from('bookings')
      .select(BUNDLE_SELECT)
      .eq('status', 'completed')
      .or('followup_sent.is.null,followup_sent.eq.false')
      .gte('updated_at', hoursAgo(8 * 24))
      .lte('updated_at', hoursAgo(6 * 24)),
  ])

  let feedbackSent = 0
  let followUpSent = 0
  let skipped = 0
  const run = async (rows: unknown[] | null, kind: 'feedback' | 'followup') => {
    for (const b of (rows ?? []) as BookingBundle[]) {
      if (!b.workspace || !b.contact_id) {
        skipped++
        continue
      }
      const res = await notifyBooking(kind, b, b.workspace)
      if (!res.ok) {
        console.error(`[bookings] ${kind} failed for ${b.id}:`, res.error)
        skipped++
        continue
      }
      await db
        .from('bookings')
        .update(kind === 'feedback' ? { feedback_sent: true } : { followup_sent: true })
        .eq('id', b.id)
        .eq('workspace_id', b.workspace_id)
      if (kind === 'feedback') feedbackSent++
      else followUpSent++
    }
  }
  await run(feedbackRes.data, 'feedback')
  await run(followRes.data, 'followup')
  return { feedbackSent, followUpSent, skipped }
}

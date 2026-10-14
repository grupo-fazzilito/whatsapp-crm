// Calendly ↔ Whasalia: pure helpers (no I/O), safe in tests.
import crypto from 'crypto'
import { zonedWallToUtc } from '@/lib/integrations/google/event'
import { zonedNow } from '@/lib/ai/time'

/** Key for Calendly OAuth `state` HMACs, derived from ENCRYPTION_KEY. */
export function calendlyStateSecret(encryptionKey = process.env.ENCRYPTION_KEY ?? ''): Buffer {
  if (!encryptionKey) throw new Error('ENCRYPTION_KEY is not set')
  return crypto.createHmac('sha256', encryptionKey).update('calendly-oauth-state').digest()
}

/** Webhooks older than this are rejected (replays). */
export const WEBHOOK_TOLERANCE_MS = 3 * 60 * 1000

/**
 * Checks `Calendly-Webhook-Signature: t=<unix>,v1=<hex>` against
 * HMAC-SHA256(signingKey, `${t}.${rawBody}`).
 */
export function verifyWebhookSignature(header: string | null, rawBody: string, signingKey: string, now = Date.now()): boolean {
  if (!header || !signingKey) return false
  const parts = Object.fromEntries(header.split(',').map((p) => p.trim().split('=') as [string, string]))
  const t = Number(parts.t)
  const v1 = parts.v1
  if (!Number.isFinite(t) || !v1 || !/^[0-9a-f]+$/i.test(v1)) return false
  if (Math.abs(now - t * 1000) > WEBHOOK_TOLERANCE_MS) return false
  const expected = crypto.createHmac('sha256', signingKey).update(`${t}.${rawBody}`).digest('hex')
  const a = Buffer.from(expected, 'hex')
  const b = Buffer.from(v1, 'hex')
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

/** Last path segment of a Calendly resource URI. */
export function uuidOf(uri: string): string {
  return uri.replace(/\/+$/, '').split('/').pop() ?? ''
}

/** Workspace-local "YYYY-MM-DD" + "HH:MM" of an ISO instant. */
export function localSlot(iso: string, timeZone: string): { date: string; time: string } {
  const z = zonedNow(timeZone, new Date(iso))
  return { date: z.date, time: z.time }
}

/** ISO UTC instant of a workspace-local date and time. */
export function utcInstant(date: string, time: string, timeZone: string): string {
  return zonedWallToUtc(date, time, timeZone).toISOString().replace('.000Z', 'Z')
}

export interface AvailableTime {
  status: string
  start_time: string
  scheduling_url?: string
}

/** Available start times grouped by local date: { "2026-10-20": ["09:00", …] }. */
export function slotsByDate(times: AvailableTime[], timeZone: string): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const t of times) {
    if (t.status !== 'available') continue
    const { date, time } = localSlot(t.start_time, timeZone)
    ;(out[date] ??= []).push(time)
  }
  for (const d of Object.keys(out)) out[d] = [...new Set(out[d])].sort()
  return out
}

/** Calendly booking page link with the customer's name and email filled in. */
export function prefilledLink(url: string, who: { name?: string | null; email?: string | null }): string {
  const u = new URL(url)
  if (who.name) u.searchParams.set('name', who.name)
  if (who.email) u.searchParams.set('email', who.email)
  return u.toString()
}

/** Location kinds where the invitee must give a value (Calendly rejects the booking otherwise). */
const INVITEE_INPUT_KINDS = new Set(['outbound_call', 'ask_invitee'])

/**
 * `location` for POST /invitees from the event type's location kinds:
 * omitted when the event type has none, the host's own kind otherwise, and
 * the customer's phone for "we call you". Null = can't be booked by API.
 */
export function inviteeLocation(kinds: string[], phone: string | null): { kind: string; location?: string } | undefined | null {
  if (!kinds.length) return undefined
  const hostKind = kinds.find((k) => !INVITEE_INPUT_KINDS.has(k))
  if (hostKind) return { kind: hostKind }
  if (kinds.includes('outbound_call') && phone) return { kind: 'outbound_call', location: phone }
  return null
}

/** Webhook / scheduled-event invitee, as Calendly sends it (fields we use). */
export interface CalendlyInvitee {
  uri: string
  email: string | null
  name: string | null
  status: 'active' | 'canceled'
  text_reminder_number?: string | null
  cancel_url?: string | null
  reschedule_url?: string | null
  rescheduled?: boolean
  questions_and_answers?: { question: string; answer: string }[]
}

export interface CalendlyScheduledEvent {
  uri: string
  start_time: string
  end_time: string
  event_type: string
  status?: 'active' | 'canceled'
}

/** Booking fields of an invitee of a scheduled event, in the workspace time zone. */
export function bookingFromInvitee(invitee: CalendlyInvitee, event: CalendlyScheduledEvent, timeZone: string) {
  const { date, time } = localSlot(event.start_time, timeZone)
  const minutes = Math.round((Date.parse(event.end_time) - Date.parse(event.start_time)) / 60000)
  const notes = (invitee.questions_and_answers ?? []).filter((q) => q.answer?.trim()).map((q) => `${q.question}: ${q.answer}`).join('\n')
  return {
    booking_date: date,
    booking_time: time,
    duration_minutes: minutes > 0 ? minutes : 30,
    customer_name: invitee.name || null,
    notes: notes || null,
    status: invitee.status === 'canceled' || event.status === 'canceled' ? ('cancelled' as const) : ('confirmed' as const),
    calendly_event_uri: event.uri,
    calendly_invitee_uri: invitee.uri,
    calendly_cancel_url: invitee.cancel_url ?? null,
    calendly_reschedule_url: invitee.reschedule_url ?? null,
  }
}

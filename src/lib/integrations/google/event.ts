// Pure mapping between bookings and Google Calendar events.
// Bookings store local 'YYYY-MM-DD' + 'HH:MM' in the workspace time zone;
// events are written as wall-clock dateTime + IANA timeZone, which Google
// accepts without an offset when timeZone is set.

import { addDays, fromMinutes, toMinutes, zonedNow } from '@/lib/ai/time'
import type { BusyInterval } from '@/lib/ai/slots'

export interface GoogleEventTime {
  dateTime?: string
  date?: string
  timeZone?: string
}

export interface GoogleEvent {
  id: string
  status?: 'confirmed' | 'tentative' | 'cancelled'
  summary?: string
  description?: string
  location?: string
  start?: GoogleEventTime
  end?: GoogleEventTime
  updated?: string
  hangoutLink?: string
  extendedProperties?: { private?: Record<string, string>; shared?: Record<string, string> }
}

export interface EventPayloadInput {
  bookingId: string
  workspaceId: string
  /** Local 'YYYY-MM-DD'. */
  date: string
  /** Local 'HH:MM'. */
  time: string
  durationMinutes: number
  timeZone: string
  status: string
  locale: 'es' | 'en'
  /** Industry noun, e.g. "Visita". */
  bookingLabel: string
  /** Product (property) or service name. */
  title?: string | null
  customerName?: string | null
  customerPhone?: string | null
  notes?: string | null
  location?: string | null
  conversationUrl?: string | null
  addMeet?: boolean
  /** Unique per (booking, sync version) for conferenceData.createRequest. */
  meetRequestId?: string
}

/** Deterministic event id (base32hex: 0-9a-v, 5–1024 chars) so retries never duplicate. */
export function eventIdFor(bookingId: string): string {
  return `bk${bookingId.toLowerCase().replace(/[^0-9a-f]/g, '')}`
}

/** Local wall clock + minutes, rolling the date over midnight. */
export function addMinutesLocal(date: string, time: string, minutes: number): { date: string; time: string } {
  const start = toMinutes(time) ?? 0
  const total = start + Math.max(0, minutes)
  const days = Math.floor(total / 1440)
  return { date: addDays(date, days), time: fromMinutes(total % 1440) }
}

const DESC = {
  es: { customer: 'Cliente', phone: 'Teléfono', notes: 'Notas', chat: 'Conversación en el CRM', footer: 'Creado por el CRM. Si mueves o eliminas este evento, la reserva se actualiza y se avisa al cliente.' },
  en: { customer: 'Customer', phone: 'Phone', notes: 'Notes', chat: 'CRM conversation', footer: 'Created by the CRM. Moving or deleting this event updates the booking and notifies the customer.' },
} as const

export function buildEventSummary(label: string, title?: string | null, customer?: string | null): string {
  const head = title ? `${label}: ${title}` : label
  return (customer ? `${head} — ${customer}` : head).slice(0, 1000)
}

/** Request body for events.insert / events.patch. */
export function buildEventPayload(input: EventPayloadInput): Record<string, unknown> {
  const time = input.time.padStart(5, '0').slice(0, 5)
  const end = addMinutesLocal(input.date, time, input.durationMinutes || 30)
  const d = DESC[input.locale] ?? DESC.es
  const lines = [
    input.customerName ? `${d.customer}: ${input.customerName}` : null,
    input.customerPhone ? `${d.phone}: ${input.customerPhone}` : null,
    input.notes ? `${d.notes}: ${input.notes}` : null,
    input.conversationUrl ? `${d.chat}: ${input.conversationUrl}` : null,
    '',
    d.footer,
  ].filter((l): l is string => l !== null)

  const body: Record<string, unknown> = {
    summary: buildEventSummary(input.bookingLabel, input.title, input.customerName),
    description: lines.join('\n').trim(),
    start: { dateTime: `${input.date}T${time}:00`, timeZone: input.timeZone },
    end: { dateTime: `${end.date}T${end.time}:00`, timeZone: input.timeZone },
    status: input.status === 'pending' ? 'tentative' : 'confirmed',
    extendedProperties: { private: { booking_id: input.bookingId, workspace_id: input.workspaceId } },
  }
  if (input.location) body.location = input.location
  if (input.addMeet) {
    body.conferenceData = {
      createRequest: { requestId: input.meetRequestId ?? input.bookingId, conferenceSolutionKey: { type: 'hangoutsMeet' } },
    }
  }
  return body
}

/** Offset of `timeZone` from UTC at instant `at`, in minutes. */
function offsetMinutes(timeZone: string, at: Date): number {
  const z = zonedNow(timeZone, at)
  const [y, m, d] = z.date.split('-').map(Number)
  const local = Date.UTC(y, m - 1, d, Number(z.time.slice(0, 2)), Number(z.time.slice(3, 5)))
  return Math.round((local - Math.floor(at.getTime() / 60000) * 60000) / 60000)
}

/** UTC instant of a wall-clock time in `timeZone`. */
export function zonedWallToUtc(date: string, time: string, timeZone: string): Date {
  const [y, m, d] = date.split('-').map(Number)
  const [h, mi] = time.split(':').map(Number)
  const guess = Date.UTC(y, m - 1, d, h, mi || 0)
  let ts = guess - offsetMinutes(timeZone, new Date(guess)) * 60000
  ts = guess - offsetMinutes(timeZone, new Date(ts)) * 60000
  return new Date(ts)
}

/** Local date/time in `timeZone` of an event time; null for all-day events. */
export function eventLocal(t: GoogleEventTime | undefined, timeZone: string): { date: string; time: string; at: number } | null {
  if (!t?.dateTime) return null
  const raw = t.dateTime
  const hasOffset = /(Z|[+-]\d{2}:?\d{2})$/.test(raw)
  let instant: Date
  if (hasOffset) instant = new Date(raw)
  else {
    const [date, rest] = raw.split('T')
    instant = zonedWallToUtc(date, rest.slice(0, 5), t.timeZone || timeZone)
  }
  if (Number.isNaN(instant.getTime())) return null
  const z = zonedNow(timeZone, instant)
  return { date: z.date, time: z.time, at: instant.getTime() }
}

export interface SyncedBooking {
  id: string
  booking_date: string
  booking_time: string
  duration_minutes: number | null
  status: string
}

export type InboundChange =
  | { kind: 'none' }
  | { kind: 'cancelled' }
  | { kind: 'moved'; date: string; time: string; durationMinutes: number }

const ACTIVE = new Set(['pending', 'confirmed'])

/** What a changed Google event means for its booking. */
export function mapInboundEvent(ev: GoogleEvent, booking: SyncedBooking, timeZone: string): InboundChange {
  if (!ACTIVE.has(booking.status)) return { kind: 'none' }
  if (ev.status === 'cancelled') return { kind: 'cancelled' }
  const start = eventLocal(ev.start, timeZone)
  const end = eventLocal(ev.end, timeZone)
  if (!start) return { kind: 'none' }
  const duration = end ? Math.max(5, Math.round((end.at - start.at) / 60000)) : booking.duration_minutes ?? 30
  const sameStart = start.date === booking.booking_date && start.time === booking.booking_time.padStart(5, '0').slice(0, 5)
  if (sameStart && duration === (booking.duration_minutes ?? 30)) return { kind: 'none' }
  return { kind: 'moved', date: start.date, time: start.time, durationMinutes: duration }
}

export type { BusyInterval }

/** freeBusy intervals (RFC3339 instants) → per-day local intervals in `timeZone`. */
export function busyToLocal(busy: { start: string; end: string }[], timeZone: string): BusyInterval[] {
  const out: BusyInterval[] = []
  for (const b of busy) {
    const s = new Date(b.start)
    const e = new Date(b.end)
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || e <= s) continue
    const ls = zonedNow(timeZone, s)
    const le = zonedNow(timeZone, e)
    if (ls.date === le.date) {
      out.push({ date: ls.date, start: ls.time, end: le.time })
      continue
    }
    out.push({ date: ls.date, start: ls.time, end: '24:00' })
    for (let d = addDays(ls.date, 1); d < le.date; d = addDays(d, 1)) out.push({ date: d, start: '00:00', end: '24:00' })
    if (le.time !== '00:00') out.push({ date: le.date, start: '00:00', end: le.time })
  }
  return out
}

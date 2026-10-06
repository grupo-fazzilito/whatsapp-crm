// Reminder scheduling for bookings. Pure (no DB) so the cron's choices can
// be unit-tested with fixed clocks. Bookings store local wall-clock
// 'YYYY-MM-DD' + 'HH:MM' of the workspace's time zone, so "hours until the
// booking" must be computed in that zone, never in the server's.

import { safeTimeZone } from '@/lib/ai/time'

export type ReminderKind = '24h' | '4h' | '2h'

export interface ReminderFlags {
  reminder_24h_sent: boolean | null
  reminder_4h_sent: boolean | null
  reminder_2h_sent: boolean | null
}

/** Offset (ms) of `timeZone` from UTC at instant `ts`. */
function zoneOffsetMs(ts: number, timeZone: string): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
  const p: Record<string, number> = {}
  for (const part of fmt.formatToParts(new Date(ts))) {
    if (part.type !== 'literal') p[part.type] = Number(part.value)
  }
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return asUtc - Math.floor(ts / 1000) * 1000
}

/** The UTC instant of a local wall-clock date + time in `timeZone`. */
export function zonedTimeToUtc(date: string, time: string, timeZone: string): Date {
  const tz = safeTimeZone(timeZone)
  const [y, m, d] = date.split('-').map(Number)
  const [h, mi] = time.split(':').map(Number)
  const wall = Date.UTC(y, m - 1, d, h, mi || 0)
  const first = zoneOffsetMs(wall - zoneOffsetMs(wall, tz), tz)
  let ts = wall - first
  // Around DST changes the offset at the guessed instant can differ.
  const second = zoneOffsetMs(ts, tz)
  if (second !== first) ts = wall - second
  return new Date(ts)
}

/** Hours from `now` until the booking starts (negative when past). */
export function hoursUntilBooking(date: string, time: string, timeZone: string, now: Date): number {
  return (zonedTimeToUtc(date, time, timeZone).getTime() - now.getTime()) / 3_600_000
}

/**
 * Which reminder is due `hoursUntil` hours before the booking. Only the
 * closest one is sent; later flags imply the earlier ones so a booking
 * created 3 hours ahead doesn't also get the 24h message on the next run.
 */
export function decideReminder(
  hoursUntil: number,
  flags: ReminderFlags,
): { kind: ReminderKind | null; updates: Partial<Record<keyof ReminderFlags, boolean>> } {
  if (!(hoursUntil > 0)) return { kind: null, updates: {} }
  if (hoursUntil <= 2.5 && !flags.reminder_2h_sent) {
    return { kind: '2h', updates: { reminder_2h_sent: true, reminder_4h_sent: true, reminder_24h_sent: true } }
  }
  if (hoursUntil > 2.5 && hoursUntil <= 5 && !flags.reminder_4h_sent) {
    return { kind: '4h', updates: { reminder_4h_sent: true, reminder_24h_sent: true } }
  }
  if (hoursUntil > 5 && hoursUntil <= 24 && !flags.reminder_24h_sent) {
    return { kind: '24h', updates: { reminder_24h_sent: true } }
  }
  return { kind: null, updates: {} }
}

export interface ReminderCandidate extends ReminderFlags {
  id: string
  booking_date: string
  booking_time: string
  status: string
  /** IANA zone of the booking's workspace. */
  timeZone: string
}

export interface DueReminder<T extends ReminderCandidate> {
  booking: T
  kind: ReminderKind
  hoursUntil: number
  updates: Partial<Record<keyof ReminderFlags, boolean>>
}

/** Bookings that need a reminder right now, each judged in its own zone. */
export function selectDueReminders<T extends ReminderCandidate>(bookings: T[], now: Date): DueReminder<T>[] {
  const out: DueReminder<T>[] = []
  for (const b of bookings) {
    if (b.status !== 'confirmed' && b.status !== 'pending') continue
    if (!b.booking_date || !b.booking_time) continue
    const hoursUntil = hoursUntilBooking(b.booking_date, b.booking_time, b.timeZone, now)
    const { kind, updates } = decideReminder(hoursUntil, b)
    if (kind) out.push({ booking: b, kind, hoursUntil, updates })
  }
  return out
}

/** 'YYYY-MM-DD' of `now` shifted by `days` in UTC (query bounds). */
export function utcDate(now: Date, days = 0): string {
  return new Date(now.getTime() + days * 86_400_000).toISOString().slice(0, 10)
}

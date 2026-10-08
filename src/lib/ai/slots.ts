// Availability engine shared by the AI agent and the booking UI.
// Pure functions over plain rows so it can be unit-tested.

import { addDays, fromMinutes, toMinutes, weekdayOf } from './time'

export interface BusinessHoursRow {
  day_name: string
  opening_time: string | null
  closing_time: string | null
  is_closed: boolean | null
  break_start: string | null
  break_end: string | null
}

export interface BusinessException {
  date: string
  is_closed: boolean
  opening_time?: string | null
  closing_time?: string | null
  reason?: string | null
}

export interface StaffSlot {
  start_time: string
  end_time?: string | null
  is_active?: boolean
}

export interface StaffRow {
  id: string
  name: string
  available_days: string[] | null
  available_start_time: string | null
  available_end_time: string | null
  weekly_slots: Record<string, StaffSlot[]> | null
  date_exceptions: { date: string; is_available: boolean; slots?: StaffSlot[]; reason?: string }[] | null
  is_active?: boolean | null
  /** External busy time (e.g. the staff member's Google Calendar). */
  busy?: BusyInterval[] | null
}

/** Busy time in business-local wall clock; end '24:00' = end of day. */
export interface BusyInterval {
  date: string
  start: string
  end: string
}

export interface BookingRow {
  staff_id: string | null
  booking_date: string
  booking_time: string
  duration_minutes: number | null
  status: string
  party_size?: number | null
}

export interface SlotQuery {
  hours: BusinessHoursRow[]
  exceptions: BusinessException[]
  bookings: BookingRow[]
  /** Business-local "now". */
  today: string
  nowTime: string
  durationMinutes: number
  /** Granularity for generated start times when there are no fixed slots. */
  stepMinutes?: number
  /** Concurrent bookings allowed per time when no staff is involved. */
  capacity?: number
  /** Extra busy time per staff id (merged with StaffRow.busy). */
  busy?: Record<string, BusyInterval[]>
}

interface Window {
  start: number
  end: number
}

const ACTIVE = new Set(['pending', 'confirmed'])

/** Opening window of the business on `date`, minus its break; null = closed. */
export function businessWindows(date: string, hours: BusinessHoursRow[], exceptions: BusinessException[]): Window[] | null {
  const ex = exceptions.find((e) => e.date === date)
  if (ex?.is_closed) return null
  const weekday = weekdayOf(date)
  const row = hours.find((h) => h.day_name.toLowerCase() === weekday.toLowerCase())

  let open = toMinutes(ex?.opening_time) ?? toMinutes(row?.opening_time)
  let close = toMinutes(ex?.closing_time) ?? toMinutes(row?.closing_time)
  if (!ex && row?.is_closed) return null
  // Unconfigured day: assume a regular 09–18 day rather than closed, so a
  // half-finished setup still books (staff availability narrows it).
  if (open === null || close === null) {
    if (row) return null
    open = 9 * 60
    close = 18 * 60
  }
  if (close <= open) return null

  const bs = toMinutes(row?.break_start)
  const be = toMinutes(row?.break_end)
  if (!ex && bs !== null && be !== null && be > bs && bs > open && be < close) {
    return [
      { start: open, end: bs },
      { start: be, end: close },
    ]
  }
  return [{ start: open, end: close }]
}

/** Candidate start times for a staff member on `date` (before conflicts). */
export function staffCandidateStarts(
  staff: StaffRow,
  date: string,
  windows: Window[],
  duration: number,
  step: number,
): number[] {
  const weekday = weekdayOf(date)
  const ex = (staff.date_exceptions ?? []).find((e) => e.date === date)
  if (ex && !ex.is_available) return []

  const fixed = (ex?.slots?.length ? ex.slots : staff.weekly_slots?.[weekday] ?? []).filter((s) => s.is_active !== false)
  if (!ex) {
    const works = (staff.available_days ?? []).some((d) => d.toLowerCase() === weekday.toLowerCase())
    if (!works && fixed.length === 0) return []
  }

  const fits = (s: number) => windows.some((w) => s >= w.start && s + duration <= w.end)

  if (fixed.length > 0) {
    return fixed
      .map((s) => toMinutes(s.start_time))
      .filter((m): m is number => m !== null)
      .filter(fits)
      .sort((a, b) => a - b)
  }

  const shiftStart = toMinutes(staff.available_start_time) ?? 9 * 60
  const shiftEnd = toMinutes(staff.available_end_time) ?? 18 * 60
  const starts: number[] = []
  for (let s = shiftStart; s + duration <= shiftEnd; s += step) if (fits(s)) starts.push(s)
  return starts
}

function overlaps(aStart: number, aDur: number, bStart: number, bDur: number) {
  return aStart < bStart + bDur && bStart < aStart + aDur
}

/** Free start times ('HH:MM') for one staff member on one date. */
export function freeSlotsForStaff(staff: StaffRow, date: string, q: SlotQuery): string[] {
  const windows = businessWindows(date, q.hours, q.exceptions)
  if (!windows || date < q.today) return []
  const step = q.stepMinutes ?? 30
  const nowMin = toMinutes(q.nowTime) ?? 0
  const taken = q.bookings.filter((b) => b.staff_id === staff.id && b.booking_date === date && ACTIVE.has(b.status))
  const blocked = busyFor(staff, date, q)
  return staffCandidateStarts(staff, date, windows, q.durationMinutes, step)
    .filter((s) => date > q.today || s > nowMin)
    .filter((s) => !taken.some((b) => overlaps(s, q.durationMinutes, toMinutes(b.booking_time) ?? -1, b.duration_minutes ?? 30)))
    .filter((s) => !blocked.some((w) => s < w.end && w.start < s + q.durationMinutes))
    .map(fromMinutes)
}

/** Busy windows (minutes) of a staff member on `date`, from both sources. */
export function busyFor(staff: StaffRow, date: string, q: Pick<SlotQuery, 'busy'>): Window[] {
  return [...(q.busy?.[staff.id] ?? []), ...(staff.busy ?? [])]
    .filter((b) => b.date === date)
    .map((b) => ({ start: toMinutes(b.start) ?? 0, end: toMinutes(b.end) ?? 0 }))
    .filter((w) => w.end > w.start)
}

/** Free start times when bookings don't need a staff member (capacity per time). */
export function freeSlotsForBusiness(date: string, q: SlotQuery): string[] {
  const windows = businessWindows(date, q.hours, q.exceptions)
  if (!windows || date < q.today) return []
  const step = q.stepMinutes ?? 30
  const capacity = Math.max(1, q.capacity ?? 1)
  const nowMin = toMinutes(q.nowTime) ?? 0
  const sameDay = q.bookings.filter((b) => b.booking_date === date && ACTIVE.has(b.status))
  const out: string[] = []
  for (const w of windows) {
    for (let s = w.start; s + q.durationMinutes <= w.end; s += step) {
      if (date === q.today && s <= nowMin) continue
      const concurrent = sameDay.filter((b) =>
        overlaps(s, q.durationMinutes, toMinutes(b.booking_time) ?? -1, b.duration_minutes ?? 30),
      ).length
      if (concurrent < capacity) out.push(fromMinutes(s))
    }
  }
  return out
}

/** Next `days` dates starting today. */
export function upcomingDates(today: string, days: number): string[] {
  return Array.from({ length: days }, (_, i) => addDays(today, i))
}

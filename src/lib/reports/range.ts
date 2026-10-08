// Report date ranges, resolved in the workspace's time zone. A range is
// a half-open instant interval [from, to) plus the list of local calendar
// days it covers (for zero-filled day charts).

import { addDays, isIsoDate, safeTimeZone, zonedNow } from '@/lib/ai/time'
import { zonedTimeToUtc } from '@/lib/bookings/reminders'

export const PRESETS = ['today', '7d', '30d', 'month', 'custom'] as const
export type Preset = (typeof PRESETS)[number]

/** Longest custom range (days). Keeps the stream query bounded. */
export const MAX_RANGE_DAYS = 366

export interface ReportRange {
  preset: Preset
  timeZone: string
  /** First local day, YYYY-MM-DD. */
  fromDate: string
  /** Last local day (inclusive), YYYY-MM-DD. */
  toDate: string
  /** Start instant (local midnight of fromDate). */
  from: Date
  /** End instant, exclusive (local midnight after toDate). */
  to: Date
  days: string[]
}

export function isPreset(v: unknown): v is Preset {
  return typeof v === 'string' && (PRESETS as readonly string[]).includes(v)
}

export function daySpan(fromDate: string, toDate: string): number {
  const a = Date.parse(`${fromDate}T00:00:00Z`)
  const b = Date.parse(`${toDate}T00:00:00Z`)
  return Math.round((b - a) / 86_400_000) + 1
}

/**
 * Resolves a preset (or a custom from/to pair of local days) in `timeZone`.
 * Returns null for an invalid custom range.
 */
export function resolveRange(
  preset: Preset,
  timeZone: string,
  now: Date = new Date(),
  custom?: { from?: string | null; to?: string | null },
): ReportRange | null {
  const tz = safeTimeZone(timeZone)
  const today = zonedNow(tz, now).date
  let fromDate: string
  let toDate = today
  switch (preset) {
    case 'today':
      fromDate = today
      break
    case '7d':
      fromDate = addDays(today, -6)
      break
    case '30d':
      fromDate = addDays(today, -29)
      break
    case 'month':
      fromDate = `${today.slice(0, 8)}01`
      break
    case 'custom': {
      if (!isIsoDate(custom?.from) || !isIsoDate(custom?.to)) return null
      fromDate = custom.from
      toDate = custom.to
      if (Number.isNaN(Date.parse(fromDate)) || Number.isNaN(Date.parse(toDate))) return null
      const span = daySpan(fromDate, toDate)
      if (span < 1 || span > MAX_RANGE_DAYS) return null
      break
    }
  }
  const days: string[] = []
  for (let d = fromDate; d <= toDate; d = addDays(d, 1)) days.push(d)
  return {
    preset,
    timeZone: tz,
    fromDate,
    toDate,
    from: zonedTimeToUtc(fromDate, '00:00', tz),
    to: zonedTimeToUtc(addDays(toDate, 1), '00:00', tz),
    days,
  }
}

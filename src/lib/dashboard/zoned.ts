// Calendar math in an IANA time zone (the viewer's), for the dashboard
// queries that now run on the server. Pure — mirrors date-utils.ts, which
// does the same in the browser's local zone.

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    })
    formatters.set(tz, f)
  }
  return f
}

/** `tz` when it is a valid IANA zone, otherwise 'UTC'. */
export function safeTimeZone(tz: string | null | undefined): string {
  if (!tz || tz.length > 64) return 'UTC'
  try {
    formatter(tz)
    return tz
  } catch {
    return 'UTC'
  }
}

const WEEKDAYS: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }

interface Parts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
  /** 0 = Monday … 6 = Sunday. */
  mondayIndex: number
}

export function zonedParts(d: Date, tz: string): Parts {
  const out: Record<string, string> = {}
  for (const p of formatter(tz).formatToParts(d)) out[p.type] = p.value
  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    hour: Number(out.hour),
    minute: Number(out.minute),
    second: Number(out.second),
    mondayIndex: WEEKDAYS[out.weekday] ?? 0,
  }
}

/** Offset of `tz` from UTC at instant `d`, in ms (local − UTC). */
function offsetMs(d: Date, tz: string): number {
  const p = zonedParts(d, tz)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return asUtc - Math.floor(d.getTime() / 1000) * 1000
}

/** Instant of local midnight of the calendar date (y, m, d) in `tz` (day may overflow). */
function zonedMidnight(year: number, month: number, day: number, tz: string): Date {
  const guess = Date.UTC(year, month - 1, day)
  const first = guess - offsetMs(new Date(guess), tz)
  const second = guess - offsetMs(new Date(first), tz)
  return new Date(second)
}

/** Start of the local day `days` days before `now`'s day, in `tz`. */
export function zonedDaysAgoStart(days: number, tz: string, now: Date = new Date()): Date {
  const p = zonedParts(now, tz)
  return zonedMidnight(p.year, p.month, p.day - days, tz)
}

/** YYYY-MM-DD of `d` in `tz`. */
export function zonedDayKey(d: Date | string, tz: string): string {
  const p = zonedParts(typeof d === 'string' ? new Date(d) : d, tz)
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

/** Local-day keys of the last `n` days (oldest first), in `tz`. */
export function zonedLastNDayKeys(n: number, tz: string, now: Date = new Date()): string[] {
  const p = zonedParts(now, tz)
  const keys: string[] = []
  for (let i = n - 1; i >= 0; i--) {
    // Noon UTC of the calendar date avoids any zone edge.
    const d = new Date(Date.UTC(p.year, p.month - 1, p.day - i, 12))
    keys.push(d.toISOString().slice(0, 10))
  }
  return keys
}

/** 0 = Monday … 6 = Sunday, in `tz`. */
export function zonedMondayIndex(d: Date, tz: string): number {
  return zonedParts(d, tz).mondayIndex
}

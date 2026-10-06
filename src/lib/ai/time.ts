// Time helpers in the business's IANA time zone. Booking dates are
// stored as local 'YYYY-MM-DD' + 'HH:MM' strings of that zone.

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const

export interface ZonedNow {
  date: string // YYYY-MM-DD
  time: string // HH:MM
  weekday: (typeof WEEKDAYS)[number]
}

function parts(d: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'long',
    hourCycle: 'h23',
  })
  const out: Record<string, string> = {}
  for (const p of fmt.formatToParts(d)) out[p.type] = p.value
  return out
}

export function safeTimeZone(tz: string | null | undefined): string {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz || 'UTC' })
    return tz || 'UTC'
  } catch {
    return 'UTC'
  }
}

export function zonedNow(timeZone: string, now: Date = new Date()): ZonedNow {
  const p = parts(now, safeTimeZone(timeZone))
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    time: `${p.hour}:${p.minute}`,
    weekday: p.weekday as ZonedNow['weekday'],
  }
}

/** 'YYYY-MM-DD' + n days (calendar arithmetic, zone-independent). */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + n))
  return dt.toISOString().slice(0, 10)
}

export function weekdayOf(date: string): (typeof WEEKDAYS)[number] {
  const [y, m, d] = date.split('-').map(Number)
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
}

export function toMinutes(hhmm: string | null | undefined): number | null {
  if (!hhmm) return null
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm)
  if (!m) return null
  return Number(m[1]) * 60 + Number(m[2])
}

export function fromMinutes(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
}

export function isIsoDate(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
}

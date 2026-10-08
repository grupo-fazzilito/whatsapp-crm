// Display helpers for report numbers (locale-aware, unit-tested).

/** Compact duration: "45 s", "4 min", "1 h 20 min", "2 d 3 h". "—" for null. */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—'
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s} s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const rm = m % 60
  if (h < 24) return rm ? `${h} h ${rm} min` : `${h} h`
  const d = Math.floor(h / 24)
  const rh = h % 24
  return rh ? `${d} d ${rh} h` : `${d} d`
}

/** Minutes with one decimal for CSV ("12.5"); empty for null. */
export function minutesValue(ms: number | null | undefined): number | null {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return null
  return Math.round(ms / 6000) / 10
}

export function formatPercent(r: number | null | undefined, locale: string): string {
  if (r === null || r === undefined || !Number.isFinite(r)) return '—'
  return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: r > 0 && r < 0.1 ? 1 : 0 }).format(r)
}

export function formatCount(n: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(n)
}

/** USD with enough decimals for sub-cent AI costs. */
export function formatUsd(v: number, locale: string): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: v !== 0 && Math.abs(v) < 1 ? 4 : 2 }).format(v)
}

/** "dd/MM" style short day label for a YYYY-MM-DD key. */
export function shortDay(day: string, locale: string): string {
  const [y, m, d] = day.split('-').map(Number)
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)))
}

/** "Nice" axis maximum and ~4 evenly spaced integer ticks. */
export function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0, 1]
  const raw = max / count
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((f) => Math.max(1, f * mag)).find((s) => s * count >= max) ?? Math.max(1, 10 * mag)
  const ticks: number[] = []
  for (let v = 0; v < max + step; v += step) {
    ticks.push(Math.round(v * 100) / 100)
    if (v >= max) break
  }
  return ticks
}

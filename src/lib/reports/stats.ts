// Small numeric helpers for report metrics.

/**
 * Percentile with linear interpolation between closest ranks (same as
 * PostgreSQL percentile_cont). `p` in [0, 1]. Null for an empty list.
 */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const q = Math.min(1, Math.max(0, p))
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

export const median = (values: readonly number[]) => percentile(values, 0.5)

/** part / whole as a 0..1 ratio; null when whole is 0. */
export function ratio(part: number, whole: number): number | null {
  return whole > 0 ? part / whole : null
}

export function sum(values: readonly number[]): number {
  let s = 0
  for (const v of values) s += v
  return s
}

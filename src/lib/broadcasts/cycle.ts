// Monthly cycles anchored on the signup date (pure: no database).

/** `at` plus `months`, keeping the day (clamped to the month's last day: Jan 31 → Feb 28) and the time. */
function addMonths(at: Date, months: number, day: number): Date {
  const y = at.getUTCFullYear()
  const m = at.getUTCMonth() + months
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
  return new Date(Date.UTC(y, m, Math.min(day, last), at.getUTCHours(), at.getUTCMinutes(), at.getUTCSeconds()))
}

/** The monthly cycle containing `now`, anchored on the signup instant. */
export function cycleBounds(signup: Date, now = new Date()): { start: Date; next: Date } {
  const day = signup.getUTCDate()
  let n = (now.getUTCFullYear() - signup.getUTCFullYear()) * 12 + (now.getUTCMonth() - signup.getUTCMonth())
  if (addMonths(signup, n, day) > now) n--
  n = Math.max(0, n)
  return { start: addMonths(signup, n, day), next: addMonths(signup, n + 1, day) }
}

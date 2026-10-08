// Retry policy for webhook deliveries.
// Attempt 1 is immediate; after each failure the next attempt waits
// 1 m, 5 m, 30 m, 2 h, 6 h, 24 h. After the 7th failed attempt the
// delivery is marked failed. An endpoint is disabled after 20
// consecutive failed attempts (any deliveries).

const MIN = 60_000
export const RETRY_SCHEDULE_MS = [1 * MIN, 5 * MIN, 30 * MIN, 120 * MIN, 360 * MIN, 1440 * MIN] as const
export const MAX_ATTEMPTS = RETRY_SCHEDULE_MS.length + 1
export const AUTO_DISABLE_AFTER = 20
export const DELIVERY_TIMEOUT_MS = 10_000
export const RESPONSE_BODY_MAX = 2048

/**
 * Delay before the next attempt after `attemptsSoFar` failed attempts
 * (1-based), or null when the delivery should be given up.
 */
export function retryDelayMs(attemptsSoFar: number): number | null {
  if (!Number.isInteger(attemptsSoFar) || attemptsSoFar < 1) return 0
  return RETRY_SCHEDULE_MS[attemptsSoFar - 1] ?? null
}

/** 2xx = delivered. Everything else (incl. 3xx: redirects are not followed) is a failure. */
export function isSuccessStatus(status: number | null | undefined): boolean {
  return typeof status === 'number' && status >= 200 && status < 300
}

export function shouldAutoDisable(consecutiveFailures: number): boolean {
  return consecutiveFailures >= AUTO_DISABLE_AFTER
}

export function truncateBody(body: string, max: number = RESPONSE_BODY_MAX): string {
  return body.length > max ? `${body.slice(0, max)}…` : body
}

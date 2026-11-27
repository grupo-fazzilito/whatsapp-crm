// How long a booking lasts when it has no service, and every how many
// minutes bookings may start (pure: no database). Stored in
// workspaces.settings; 30 / 30 when not set.

export const DURATION_OPTIONS = [15, 30, 45, 60, 90, 120] as const
export const STEP_OPTIONS = [15, 30, 60] as const

export function bookingDefaults(settings: unknown): { duration: number; step: number } {
  const s = settings && typeof settings === 'object' ? (settings as Record<string, unknown>) : {}
  const d = Number(s.booking_default_duration)
  const st = Number(s.booking_step)
  return {
    duration: (DURATION_OPTIONS as readonly number[]).includes(d) ? d : 30,
    step: (STEP_OPTIONS as readonly number[]).includes(st) ? st : 30,
  }
}

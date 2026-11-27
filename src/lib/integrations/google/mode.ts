// Which Google Calendar the bookings use (pure: no database).
//   business: one calendar for the whole business.
//   staff: each professional connects their own (needs the professionals module).
import { resolveIndustry } from '@/lib/industries'
import type { WorkspaceSettings } from '@/lib/workspace/types'

export type CalendarMode = 'business' | 'staff'
export const CALENDAR_MODES: readonly CalendarMode[] = ['business', 'staff']

export function calendarMode(industry: string | null | undefined, settings: WorkspaceSettings | null | undefined): CalendarMode {
  const { modules } = resolveIndustry(industry || 'generic', settings ?? null)
  if (!modules.staff) return 'business'
  return settings?.calendar_mode === 'business' ? 'business' : 'staff'
}

/** The connection a booking goes to: its professional's in staff mode, the business's otherwise. */
export function pickConnection<T extends { staff_id: string | null }>(mode: CalendarMode, connections: T[], staffId: string | null): T | null {
  if (mode === 'business') return connections.find((c) => c.staff_id === null) ?? null
  return staffId ? (connections.find((c) => c.staff_id === staffId) ?? null) : null
}

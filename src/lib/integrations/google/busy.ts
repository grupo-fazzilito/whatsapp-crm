import 'server-only'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { addDays } from '@/lib/ai/time'
import { CONNECTION_COLUMNS, freeBusy, type CalendarConnection } from './api'
import { busyToLocal, zonedWallToUtc, type BusyInterval } from './event'

// Google busy time of connected staff, for the availability engine.
// Cached ~2 minutes per connection; a failing calendar never breaks
// booking (logged, treated as free).

const TTL_MS = 2 * 60_000
const TIMEOUT_MS = 5_000
const cache = new Map<string, { at: number; busy: { start: string; end: string }[] }>()

export function invalidateStaffBusy(connectionId?: string) {
  if (!connectionId) return cache.clear()
  for (const k of cache.keys()) if (k.startsWith(`${connectionId}:`)) cache.delete(k)
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`timed out after ${ms}ms`)), ms))])
}

/**
 * Busy intervals (business-local) per staff id for `days` days from
 * `today`. Staff without an active connection are absent.
 */
export async function loadStaffBusy(
  workspaceId: string,
  timeZone: string,
  today: string,
  days: number,
  opts: { fresh?: boolean; staffIds?: string[] } = {},
): Promise<Record<string, BusyInterval[]>> {
  let query = supabaseAdmin().from('calendar_connections').select(CONNECTION_COLUMNS).eq('workspace_id', workspaceId).neq('status', 'revoked')
  if (opts.staffIds?.length) query = query.in('staff_id', opts.staffIds)
  const { data, error } = await query
  if (error || !data?.length) return {}

  const timeMin = zonedWallToUtc(today, '00:00', timeZone).toISOString()
  const timeMax = zonedWallToUtc(addDays(today, days + 1), '00:00', timeZone).toISOString()
  const out: Record<string, BusyInterval[]> = {}
  await Promise.all(
    (data as CalendarConnection[]).map(async (conn) => {
      const key = `${conn.id}:${timeMin}:${timeMax}`
      const hit = cache.get(key)
      let busy = !opts.fresh && hit && Date.now() - hit.at < TTL_MS ? hit.busy : null
      if (!busy) {
        try {
          busy = await withTimeout(freeBusy(conn, timeMin, timeMax), TIMEOUT_MS)
          cache.set(key, { at: Date.now(), busy })
        } catch (err) {
          console.warn(`[google] freeBusy failed for staff ${conn.staff_id}:`, err instanceof Error ? err.message : err)
          return
        }
      }
      out[conn.staff_id] = busyToLocal(busy, timeZone)
    }),
  )
  return out
}

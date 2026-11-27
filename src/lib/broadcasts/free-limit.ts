import 'server-only'
import { tenantDb } from '@/lib/db/tenant'
import { hasActiveSubscription } from '@/lib/billing/subscriptions'
import { safeTimeZone, zonedNow } from '@/lib/ai/time'
import { zonedWallToUtc } from '@/lib/integrations/google/event'

// Free plan: up to FREE_BROADCAST_LIMIT broadcast recipients a calendar month
// (WhatsApp and Messenger together, in the business's time zone). The paid
// plan has no limit. Failed sends don't count.

export const FREE_BROADCAST_LIMIT = 1000

export interface BroadcastQuota {
  /** null: no limit (paid plan). */
  limit: number | null
  used: number
  remaining: number | null
  /** First instant of next month (when the count starts again). */
  resets_at: string
}

export class BroadcastLimitError extends Error {
  constructor(public quota: BroadcastQuota, public requested: number) {
    super('broadcast_limit')
    this.name = 'BroadcastLimitError'
  }
}

function monthBounds(timeZone: string, now = new Date()): { start: Date; next: Date } {
  const today = zonedNow(timeZone, now).date
  const [y, m] = today.split('-').map(Number)
  const first = `${y}-${String(m).padStart(2, '0')}-01`
  const nextFirst = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
  return { start: zonedWallToUtc(first, '00:00', timeZone), next: zonedWallToUtc(nextFirst, '00:00', timeZone) }
}

export async function broadcastQuota(workspaceId: string, now = new Date()): Promise<BroadcastQuota> {
  const db = tenantDb(workspaceId)
  const ws = await db.workspaces.findFirst({ select: { timezone: true }, where: { id: workspaceId } })
  const { start, next } = monthBounds(safeTimeZone(ws?.timezone), now)
  const paid = await hasActiveSubscription(workspaceId, now)
  const used = await db.broadcast_recipients.count({ where: { created_at: { gte: start, lt: next }, status: { not: 'failed' } } })
  const limit = paid ? null : FREE_BROADCAST_LIMIT
  return { limit, used, remaining: limit === null ? null : Math.max(0, limit - used), resets_at: next.toISOString() }
}

/** Throws BroadcastLimitError when `count` more recipients don't fit this month. */
export async function assertBroadcastQuota(workspaceId: string, count: number): Promise<void> {
  const quota = await broadcastQuota(workspaceId)
  if (quota.remaining !== null && count > quota.remaining) throw new BroadcastLimitError(quota, count)
}

import 'server-only'
import { tenantDb } from '@/lib/db/tenant'
import { hasActiveSubscription } from '@/lib/billing/subscriptions'
import { cycleBounds } from './cycle'

// Free plan: up to FREE_BROADCAST_LIMIT broadcast recipients per monthly
// cycle that starts on the day the business signed up (signed up on the 12th
// → 12th to 12th). WhatsApp and Messenger together; failed sends don't count.
// The paid plan has no limit.

export const FREE_BROADCAST_LIMIT = 500

export interface BroadcastQuota {
  /** null: no limit (paid plan). */
  limit: number | null
  used: number
  remaining: number | null
  /** When the count starts again (next monthly anniversary of the signup). */
  resets_at: string
}

export class BroadcastLimitError extends Error {
  constructor(public quota: BroadcastQuota, public requested: number) {
    super('broadcast_limit')
    this.name = 'BroadcastLimitError'
  }
}

export async function broadcastQuota(workspaceId: string, now = new Date()): Promise<BroadcastQuota> {
  const db = tenantDb(workspaceId)
  const ws = await db.workspaces.findFirst({ select: { created_at: true }, where: { id: workspaceId } })
  const { start, next } = cycleBounds(ws?.created_at ? new Date(ws.created_at) : now, now)
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

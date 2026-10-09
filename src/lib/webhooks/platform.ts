import 'server-only'
import { prisma } from '@/lib/db/prisma'
import { normalizeRaw } from '@/lib/db/compat'
import { decrypt } from '@/lib/whatsapp/encryption'
import { signatureHeader } from './signature'
import { WEBHOOK_HEADERS } from './events'
import { deliveryBody, postJson, type PostResult } from './deliver'
import { MAX_ATTEMPTS, isSuccessStatus, retryDelayMs, shouldAutoDisable, truncateBody } from './backoff'
import type { PlatformOnlyEvent } from './platform-events'

// Platform webhooks: endpoints configured by the platform admin. Events are
// queued in platform_webhook_deliveries by database triggers (workspace
// events through webhook_emit, platform events through their own triggers)
// or by emitPlatformEvent, and delivered by the automations cron. Same
// envelope, signature and retry schedule as workspace webhooks.

interface PlatformDelivery {
  id: string
  workspace_id: string | null
  endpoint_id: string
  event_id: string
  event_type: string
  payload: Record<string, unknown>
  status: 'pending' | 'delivered' | 'failed'
  attempts: number
  next_attempt_at: string | null
  created_at: string
}

interface PlatformEndpoint {
  id: string
  url: string
  secret_encrypted: string
  active: boolean
  failure_count: number
}

/** Endpoint columns safe to return (never the secret). */
export const PLATFORM_ENDPOINT_SELECT = {
  id: true,
  url: true,
  description: true,
  events: true,
  active: true,
  failure_count: true,
  disabled_at: true,
  disabled_reason: true,
  last_success_at: true,
  last_failure_at: true,
  created_at: true,
  updated_at: true,
} as const

const ENDPOINT_SELECT = { id: true, url: true, secret_encrypted: true, active: true, failure_count: true } as const

async function quiet(op: Promise<unknown>): Promise<void> {
  try {
    await op
  } catch (err) {
    console.error('[platform-webhooks] write failed:', err instanceof Error ? err.message : err)
  }
}

/** Queues a platform event emitted from app code (no trigger for it). Never throws. */
export async function emitPlatformEvent(workspaceId: string | null, type: PlatformOnlyEvent, data: Record<string, unknown>): Promise<number> {
  try {
    const rows = normalizeRaw(
      await prisma.$queryRaw<{ queued: number | null }[]>`
        SELECT public.platform_webhook_emit(${workspaceId}::uuid, ${type}, ${JSON.stringify(data)}::jsonb) AS queued`,
    )
    return Number(rows[0]?.queued ?? 0)
  } catch (err) {
    console.error(`[platform-webhooks] emit ${type} failed:`, err instanceof Error ? err.message : err)
    return 0
  }
}

async function send(endpoint: PlatformEndpoint, delivery: PlatformDelivery): Promise<PostResult> {
  const body = deliveryBody({ ...delivery, workspace_id: delivery.workspace_id ?? (null as unknown as string) })
  let secret: string
  try {
    secret = decrypt(endpoint.secret_encrypted)
  } catch {
    return { status: null, body: '', durationMs: 0, error: 'secret_unreadable' }
  }
  return postJson(endpoint.url, body, {
    'Content-Type': 'application/json',
    'User-Agent': 'Whasalia-Webhooks/1.0',
    [WEBHOOK_HEADERS.event]: delivery.event_type,
    [WEBHOOK_HEADERS.delivery]: delivery.id,
    [WEBHOOK_HEADERS.signature]: signatureHeader(secret, body),
  })
}

export interface PlatformAttempt {
  delivered: boolean
  status: number | null
  durationMs: number
  error?: string
}

/** Sends one delivery and records the result (retry schedule, auto-disable after repeated failures). */
async function attempt(endpoint: PlatformEndpoint, delivery: PlatformDelivery, opts: { countFailures?: boolean; retry?: boolean } = {}): Promise<PlatformAttempt> {
  const countFailures = opts.countFailures ?? true
  const result = await send(endpoint, delivery)
  const attempts = delivery.attempts + 1
  const now = new Date()
  const delivered = isSuccessStatus(result.status)
  let status: PlatformDelivery['status'] = 'delivered'
  let next: Date | null = null
  if (!delivered) {
    const delay = opts.retry === false || attempts >= MAX_ATTEMPTS ? null : retryDelayMs(attempts)
    status = delay === null ? 'failed' : 'pending'
    next = delay === null ? null : new Date(now.getTime() + delay)
  }
  await quiet(
    prisma.platform_webhook_deliveries.updateMany({
      where: { id: delivery.id },
      data: {
        status,
        attempts,
        next_attempt_at: next,
        last_attempt_at: now,
        response_status: result.status,
        response_body: result.body ? truncateBody(result.body) : null,
        error: delivered ? null : result.error ?? `HTTP ${result.status}`,
        duration_ms: result.durationMs,
      },
    }),
  )
  if (delivered) {
    await quiet(prisma.platform_webhook_endpoints.updateMany({ where: { id: endpoint.id }, data: { failure_count: 0, last_success_at: now } }))
    endpoint.failure_count = 0
  } else if (countFailures) {
    const failures = endpoint.failure_count + 1
    endpoint.failure_count = failures
    const disable = shouldAutoDisable(failures) && endpoint.active
    await quiet(
      prisma.platform_webhook_endpoints.updateMany({
        where: { id: endpoint.id },
        data: {
          failure_count: failures,
          last_failure_at: now,
          ...(disable ? { active: false, disabled_at: now, disabled_reason: 'consecutive_failures' } : {}),
        },
      }),
    )
    if (disable) {
      endpoint.active = false
      console.warn(`[platform-webhooks] endpoint ${endpoint.url} disabled after ${failures} consecutive failures`)
    }
  }
  return { delivered, status: result.status, durationMs: result.durationMs, ...(result.error ? { error: result.error } : {}) }
}

const RUN_BUDGET_MS = 20_000
const PARALLEL_ENDPOINTS = 6
const RETENTION_DAYS = 30

/** Cron worker: delivers due platform deliveries, in order per endpoint. */
export async function processPlatformWebhookDeliveries(limit = 100) {
  const deadline = Date.now() + RUN_BUDGET_MS
  const stats = { claimed: 0, delivered: 0, retried: 0, failed: 0, deferred: 0 }
  const rows = normalizeRaw(
    await prisma.$queryRaw<PlatformDelivery[]>`SELECT * FROM public.platform_webhook_claim_deliveries(${limit}::integer, ${120}::integer)`,
  )
  stats.claimed = rows.length
  if (!rows.length) {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000)
    await quiet(prisma.platform_webhook_deliveries.deleteMany({ where: { created_at: { lt: cutoff }, status: { not: 'pending' } } }))
    return stats
  }
  const endpoints = await prisma.platform_webhook_endpoints.findMany({ select: ENDPOINT_SELECT, where: { id: { in: [...new Set(rows.map((r) => r.endpoint_id))] } } })
  const byId = new Map(endpoints.map((e) => [e.id, e as PlatformEndpoint]))
  const groups = new Map<string, PlatformDelivery[]>()
  for (const r of rows.sort((a, b) => a.created_at.localeCompare(b.created_at))) groups.set(r.endpoint_id, [...(groups.get(r.endpoint_id) ?? []), r])

  const runGroup = async (endpointId: string, list: PlatformDelivery[]) => {
    const endpoint = byId.get(endpointId)
    if (!endpoint || !endpoint.active) {
      await quiet(
        prisma.platform_webhook_deliveries.updateMany({
          where: { id: { in: list.map((r) => r.id) } },
          data: { status: 'failed', next_attempt_at: null, error: 'endpoint_disabled' },
        }),
      )
      stats.failed += list.length
      return
    }
    let failedThisRun = false
    for (const row of list) {
      if (failedThisRun || Date.now() > deadline || !endpoint.active) {
        await quiet(
          prisma.platform_webhook_deliveries.updateMany({
            where: { id: row.id },
            data: { next_attempt_at: new Date(Date.now() + (failedThisRun ? 60_000 : 0)) },
          }),
        )
        stats.deferred++
        continue
      }
      const out = await attempt(endpoint, row)
      if (out.delivered) stats.delivered++
      else {
        failedThisRun = true
        if (row.attempts + 1 >= MAX_ATTEMPTS) stats.failed++
        else stats.retried++
      }
    }
  }
  const entries = [...groups.entries()]
  for (let i = 0; i < entries.length; i += PARALLEL_ENDPOINTS) {
    await Promise.all(entries.slice(i, i + PARALLEL_ENDPOINTS).map(([id, list]) => runGroup(id, list)))
  }
  return stats
}

async function loadEndpoint(id: string): Promise<PlatformEndpoint | null> {
  return (await prisma.platform_webhook_endpoints.findUnique({ select: ENDPOINT_SELECT, where: { id } }).catch(() => null)) as PlatformEndpoint | null
}

async function insertDelivery(endpointId: string, workspaceId: string | null, eventId: string, type: string, payload: Record<string, unknown>) {
  const row = await prisma.platform_webhook_deliveries.create({
    data: { endpoint_id: endpointId, workspace_id: workspaceId, event_id: eventId, event_type: type, payload: payload as object, next_attempt_at: null },
  })
  return normalizeRaw([row])[0] as unknown as PlatformDelivery
}

/** Sends a "ping" to one endpoint right away (does not count as a failure). */
export async function sendPlatformTestPing(endpointId: string) {
  const endpoint = await loadEndpoint(endpointId)
  if (!endpoint) return null
  const eventId = 'evt_' + crypto.randomUUID().replace(/-/g, '')
  const payload = { id: eventId, type: 'ping', created_at: new Date().toISOString(), workspace_id: null, data: { message: 'Whasalia platform webhook test' } }
  const delivery = await insertDelivery(endpoint.id, null, eventId, 'ping', payload)
  return { ...(await attempt(endpoint, delivery, { countFailures: false, retry: false })), deliveryId: delivery.id }
}

/** Re-sends a past delivery now as a new delivery with the same event. */
export async function resendPlatformDelivery(deliveryId: string) {
  const original = await prisma.platform_webhook_deliveries.findUnique({ where: { id: deliveryId } }).catch(() => null)
  if (!original) return { error: 'not_found' as const }
  const endpoint = await loadEndpoint(original.endpoint_id)
  if (!endpoint || !endpoint.active) return { error: 'endpoint_disabled' as const }
  const delivery = await insertDelivery(endpoint.id, original.workspace_id, original.event_id, original.event_type, original.payload as Record<string, unknown>)
  return { ...(await attempt(endpoint, delivery, { retry: false })), deliveryId: delivery.id }
}

import 'server-only'
import http from 'http'
import https from 'https'
import type { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/db/prisma'
import { tenantDb } from '@/lib/db/tenant'
import { normalizeRaw } from '@/lib/db/compat'
import { decrypt } from '@/lib/whatsapp/encryption'
import { createTranslator } from '@/i18n/translate'
import { checkWebhookUrl, defaultUrlPolicy, guardedLookup } from './ssrf'
import { signatureHeader } from './signature'
import { WEBHOOK_HEADERS } from './events'
import {
  DELIVERY_TIMEOUT_MS,
  MAX_ATTEMPTS,
  RESPONSE_BODY_MAX,
  isSuccessStatus,
  retryDelayMs,
  shouldAutoDisable,
  truncateBody,
} from './backoff'

export interface DeliveryRow {
  id: string
  workspace_id: string
  endpoint_id: string
  event_id: string
  event_type: string
  payload: Record<string, unknown>
  status: 'pending' | 'delivered' | 'failed'
  attempts: number
  next_attempt_at: string | null
  created_at: string
}

export interface EndpointRow {
  id: string
  workspace_id: string
  url: string
  secret_encrypted: string
  active: boolean
  failure_count: number
}

export interface PostResult {
  status: number | null
  body: string
  durationMs: number
  error?: string
}

// ------------------------------------------------------------
// HTTP
// ------------------------------------------------------------

/** One POST with SSRF guard, no redirects, 10 s total timeout. Never throws. */
export async function postJson(rawUrl: string, body: string, headers: Record<string, string>): Promise<PostResult> {
  const started = Date.now()
  const policy = defaultUrlPolicy()
  const check = checkWebhookUrl(rawUrl, policy)
  if (!check.ok) return { status: null, body: '', durationMs: 0, error: `url_rejected:${check.reason}` }
  const url = check.url
  const client = url.protocol === 'https:' ? https : http

  return new Promise<PostResult>((resolve) => {
    let settled = false
    const done = (r: Omit<PostResult, 'durationMs'>) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ ...r, durationMs: Date.now() - started })
    }
    const req = client.request(
      url,
      {
        method: 'POST',
        headers: { ...headers, 'Content-Length': Buffer.byteLength(body).toString() },
        lookup: guardedLookup(policy.allowLoopback) as unknown as typeof import('dns').lookup,
        agent: false,
      },
      (res) => {
        const chunks: Buffer[] = []
        let size = 0
        res.on('data', (c: Buffer) => {
          if (size < RESPONSE_BODY_MAX + 1) {
            chunks.push(c)
            size += c.length
          }
          if (size > RESPONSE_BODY_MAX) res.destroy()
        })
        const finish = () => done({ status: res.statusCode ?? null, body: truncateBody(Buffer.concat(chunks).toString('utf8')) })
        res.on('end', finish)
        res.on('close', finish)
        res.on('error', finish)
      },
    )
    const timer = setTimeout(() => {
      req.destroy(new Error('timeout'))
      done({ status: null, body: '', error: `timeout after ${DELIVERY_TIMEOUT_MS / 1000}s` })
    }, DELIVERY_TIMEOUT_MS)
    req.on('error', (err: NodeJS.ErrnoException) => {
      done({ status: null, body: '', error: err.code === 'ESSRF' ? 'url_rejected:private_address' : err.message.slice(0, 300) })
    })
    req.end(body)
  })
}

/** Canonical envelope (stable key order) as the signed body. */
export function deliveryBody(d: Pick<DeliveryRow, 'payload' | 'event_id' | 'event_type' | 'workspace_id' | 'created_at'>): string {
  const p = d.payload ?? {}
  return JSON.stringify({
    id: (p.id as string) ?? d.event_id,
    type: (p.type as string) ?? d.event_type,
    created_at: (p.created_at as string) ?? new Date(d.created_at).toISOString(),
    workspace_id: (p.workspace_id as string) ?? d.workspace_id,
    data: p.data ?? {},
  })
}

function secretOf(endpoint: EndpointRow): string {
  return decrypt(endpoint.secret_encrypted)
}

async function send(endpoint: EndpointRow, delivery: DeliveryRow): Promise<PostResult> {
  const body = deliveryBody(delivery)
  let secret: string
  try {
    secret = secretOf(endpoint)
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

// ------------------------------------------------------------
// Bookkeeping
// ------------------------------------------------------------

const ENDPOINT_SELECT = { id: true, workspace_id: true, url: true, secret_encrypted: true, active: true, failure_count: true } as const

/** Write whose failure is ignored (supabase-js returned it as `error`). */
async function quiet(op: Promise<unknown>): Promise<void> {
  try {
    await op
  } catch (err) {
    console.error('[webhooks] write failed:', err instanceof Error ? err.message : err)
  }
}

async function notifyDisabled(endpoint: EndpointRow): Promise<void> {
  const db = tenantDb(endpoint.workspace_id)
  const [admins, ws] = await Promise.all([
    db.workspace_members
      .findMany({ select: { user_id: true }, where: { workspace_id: endpoint.workspace_id, status: 'active', role: { in: ['owner', 'admin'] } } })
      .catch(() => null),
    db.workspaces.findFirst({ select: { locale: true }, where: { id: endpoint.workspace_id } }).catch(() => null),
  ])
  const t = createTranslator(ws?.locale === 'en' ? 'en' : 'es')
  const rows = (admins ?? []).map((a) => ({
    workspace_id: endpoint.workspace_id,
    user_id: a.user_id,
    type: 'system',
    title: t('integrations.notify.disabledTitle'),
    body: t('integrations.notify.disabledBody', { url: endpoint.url }),
    link: '/settings?tab=integrations',
  }))
  if (rows.length) {
    try {
      await db.notifications.createMany({ data: rows })
    } catch (error) {
      console.error('[webhooks] disable notification failed:', error instanceof Error ? error.message : error)
    }
  }
}

export interface AttemptOutcome {
  delivered: boolean
  status: number | null
  durationMs: number
  error?: string
}

/**
 * Sends one delivery and records the result: delivered, rescheduled per
 * the backoff schedule, or failed for good. Endpoint failure counters are
 * updated (and the endpoint disabled after 20 consecutive failures) unless
 * `countFailures` is false (test pings).
 */
export async function attemptDelivery(
  endpoint: EndpointRow,
  delivery: DeliveryRow,
  opts: { countFailures?: boolean; retry?: boolean } = {},
): Promise<AttemptOutcome> {
  const db = tenantDb(delivery.workspace_id)
  const countFailures = opts.countFailures ?? true
  const result = await send(endpoint, delivery)
  const attempts = delivery.attempts + 1
  const now = new Date()
  const delivered = isSuccessStatus(result.status)

  let status: DeliveryRow['status'] = 'delivered'
  let next: string | null = null
  if (!delivered) {
    const delay = opts.retry === false || attempts >= MAX_ATTEMPTS ? null : retryDelayMs(attempts)
    status = delay === null ? 'failed' : 'pending'
    next = delay === null ? null : new Date(now.getTime() + delay).toISOString()
  }

  await quiet(
    db.webhook_deliveries.updateMany({
      where: { id: delivery.id },
      data: {
        status,
        attempts,
        next_attempt_at: next,
        last_attempt_at: now.toISOString(),
        response_status: result.status,
        response_body: result.body ? truncateBody(result.body) : null,
        error: delivered ? null : result.error ?? `HTTP ${result.status}`,
        duration_ms: result.durationMs,
      },
    }),
  )

  if (delivered) {
    if (endpoint.failure_count !== 0 || countFailures) {
      await quiet(
        db.webhook_endpoints.updateMany({ where: { id: endpoint.id }, data: { failure_count: 0, last_success_at: now.toISOString() } }),
      )
      endpoint.failure_count = 0
    }
  } else if (countFailures) {
    const failures = endpoint.failure_count + 1
    endpoint.failure_count = failures
    const disable = shouldAutoDisable(failures) && endpoint.active
    await quiet(
      db.webhook_endpoints.updateMany({
        where: { id: endpoint.id },
        data: {
          failure_count: failures,
          last_failure_at: now.toISOString(),
          ...(disable ? { active: false, disabled_at: now.toISOString(), disabled_reason: 'consecutive_failures' } : {}),
        },
      }),
    )
    if (disable) {
      endpoint.active = false
      await notifyDisabled(endpoint).catch((err) => console.error('[webhooks] notify failed:', err))
    }
  }

  return { delivered, status: result.status, durationMs: result.durationMs, ...(result.error ? { error: result.error } : {}) }
}

// ------------------------------------------------------------
// Cron worker
// ------------------------------------------------------------

const RUN_BUDGET_MS = 25_000
const PARALLEL_ENDPOINTS = 6
const RETENTION_DAYS = 30

export interface ProcessStats {
  claimed: number
  delivered: number
  retried: number
  failed: number
  deferred: number
}

/**
 * Delivers due webhook deliveries (claimed with a lease so overlapping
 * cron runs don't double-send). Deliveries of one endpoint go out in
 * order, one at a time; once an endpoint fails in this run its remaining
 * deliveries are deferred instead of each waiting for the timeout.
 */
export async function processWebhookDeliveries(limit = 100): Promise<ProcessStats> {
  const deadline = Date.now() + RUN_BUDGET_MS
  const stats: ProcessStats = { claimed: 0, delivered: 0, retried: 0, failed: 0, deferred: 0 }

  // Platform task: claims due deliveries of every workspace (lease, SKIP LOCKED).
  const rows = normalizeRaw(
    await prisma.$queryRaw<DeliveryRow[]>`SELECT * FROM public.webhook_claim_deliveries(${limit}::integer, ${120}::integer)`,
  )
  stats.claimed = rows.length
  if (!rows.length) {
    await cleanupOldDeliveries().catch(() => undefined)
    return stats
  }

  // Each endpoint is read together with the workspace of its deliveries.
  const endpointKeys = new Map(rows.map((r) => [r.endpoint_id, r.workspace_id]))
  const endpoints = await prisma.webhook_endpoints
    .findMany({
      select: ENDPOINT_SELECT,
      where: { OR: [...endpointKeys].map(([id, workspace_id]) => ({ id, workspace_id })) },
    })
    .catch(() => null)
  const byId = new Map((endpoints ?? []).map((e) => [e.id as string, e as EndpointRow]))

  const groups = new Map<string, DeliveryRow[]>()
  for (const r of rows.sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    const list = groups.get(r.endpoint_id) ?? []
    list.push(r)
    groups.set(r.endpoint_id, list)
  }

  const runGroup = async (endpointId: string, list: DeliveryRow[]) => {
    const endpoint = byId.get(endpointId)
    if (!endpoint || !endpoint.active) {
      await quiet(
        tenantDb(list[0].workspace_id).webhook_deliveries.updateMany({
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
        // Try again soon without spending an attempt.
        await quiet(
          tenantDb(row.workspace_id).webhook_deliveries.updateMany({
            where: { id: row.id },
            data: { next_attempt_at: new Date(Date.now() + (failedThisRun ? 60_000 : 0)).toISOString() },
          }),
        )
        stats.deferred++
        continue
      }
      const out = await attemptDelivery(endpoint, row)
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

/** Keeps the deliveries log bounded (30 days). */
export async function cleanupOldDeliveries(): Promise<void> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000).toISOString()
  // Platform task: retention over every workspace.
  await quiet(prisma.webhook_deliveries.deleteMany({ where: { created_at: { lt: cutoff }, status: { not: 'pending' } } }))
}

// ------------------------------------------------------------
// Manual actions (settings UI)
// ------------------------------------------------------------

async function loadEndpoint(workspaceId: string, endpointId: string): Promise<EndpointRow | null> {
  const data = await tenantDb(workspaceId)
    .webhook_endpoints.findFirst({ select: ENDPOINT_SELECT, where: { id: endpointId, workspace_id: workspaceId } })
    .catch(() => null)
  return (data as EndpointRow | null) ?? null
}

async function insertDelivery(row: Omit<DeliveryRow, 'id' | 'status' | 'attempts' | 'next_attempt_at' | 'created_at'>, pending: boolean): Promise<DeliveryRow> {
  const data = await tenantDb(row.workspace_id).webhook_deliveries.create({
    data: {
      ...row,
      payload: row.payload as Prisma.InputJsonValue,
      status: 'pending',
      // Not claimable by the cron while we send it right now.
      next_attempt_at: pending ? new Date(Date.now() + 120_000).toISOString() : null,
    },
    select: {
      id: true,
      workspace_id: true,
      endpoint_id: true,
      event_id: true,
      event_type: true,
      payload: true,
      status: true,
      attempts: true,
      next_attempt_at: true,
      created_at: true,
    },
  })
  return data as unknown as DeliveryRow
}

/** Sends a `ping` event to one endpoint now (no retries, doesn't count as a failure). */
export async function sendTestPing(workspaceId: string, endpointId: string): Promise<(AttemptOutcome & { deliveryId: string }) | null> {
  const endpoint = await loadEndpoint(workspaceId, endpointId)
  if (!endpoint) return null
  const eventId = `evt_${crypto.randomUUID().replace(/-/g, '')}`
  const payload = {
    id: eventId,
    type: 'ping',
    created_at: new Date().toISOString(),
    workspace_id: workspaceId,
    data: { message: 'Whasalia webhook test', endpoint_id: endpointId },
  }
  const delivery = await insertDelivery({ workspace_id: workspaceId, endpoint_id: endpointId, event_id: eventId, event_type: 'ping', payload }, true)
  const out = await attemptDelivery(endpoint, delivery, { countFailures: false, retry: false })
  return { ...out, deliveryId: delivery.id }
}

/** Re-sends a past delivery (same event id) now; failures follow the normal retry schedule. */
export async function resendDelivery(workspaceId: string, deliveryId: string): Promise<(AttemptOutcome & { deliveryId: string }) | { error: 'not_found' | 'endpoint_disabled' }> {
  const original = await tenantDb(workspaceId)
    .webhook_deliveries.findFirst({
      select: { endpoint_id: true, event_id: true, event_type: true, payload: true },
      where: { id: deliveryId, workspace_id: workspaceId },
    })
    .catch(() => null)
  if (!original) return { error: 'not_found' }
  const endpoint = await loadEndpoint(workspaceId, original.endpoint_id)
  if (!endpoint) return { error: 'not_found' }
  if (!endpoint.active) return { error: 'endpoint_disabled' }
  const delivery = await insertDelivery(
    { workspace_id: workspaceId, endpoint_id: endpoint.id, event_id: original.event_id, event_type: original.event_type, payload: original.payload as Record<string, unknown> },
    true,
  )
  const out = await attemptDelivery(endpoint, delivery, { retry: original.event_type !== 'ping', countFailures: original.event_type !== 'ping' })
  return { ...out, deliveryId: delivery.id }
}

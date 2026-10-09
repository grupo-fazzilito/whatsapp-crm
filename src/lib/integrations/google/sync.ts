import 'server-only'
import crypto from 'crypto'
import { after } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { tenantDb } from '@/lib/db/tenant'
import { safeTimeZone, zonedNow } from '@/lib/ai/time'
import { industryLabel } from '@/lib/industries'
import { sendMessage } from '@/lib/messaging/send'
import { sendToContact } from '@/lib/messaging/conversations'
import type { WorkspaceSettings } from '@/lib/workspace/types'
import {
  CONNECTION_SELECT,
  deleteEvent,
  insertEvent,
  listEvents,
  loadSecrets,
  markConnection,
  patchEvent,
  stopChannel,
  watchEvents,
  type CalendarConnection,
} from './api'
import { invalidateStaffBusy } from './busy'
import { pushSupported, siteUrl, webhookUrl } from './endpoints'
import { buildEventPayload, eventIdFor, mapInboundEvent, type GoogleEvent } from './event'
import { GoogleApiError, revokeToken } from './oauth'
import { cancelledText, rescheduledText } from './texts'

// Booking ⇄ Google Calendar event synchronisation.
//
// Outbound: a DB trigger (migration 035) flags bookings whose visible data
// changed (google_sync_state = 'pending', google_sync_version + 1). The
// worker below pushes them right away when the change happened in a
// request (scheduleBookingSync) and the cron retries whatever is left.
// Event ids are derived from the booking id, so retries never duplicate.
//
// Inbound: push notifications (or polling) run an incremental events.list
// with the stored syncToken; events carrying our booking update it.

const ACTIVE = new Set(['pending', 'confirmed'])
const DROP_EVENT = new Set(['cancelled', 'no_show'])
const MAX_ATTEMPTS = 8

interface BookingForSync {
  id: string
  workspace_id: string
  staff_id: string | null
  contact_id: string | null
  conversation_id: string | null
  status: string
  booking_date: string
  booking_time: string
  duration_minutes: number | null
  customer_name: string | null
  notes: string | null
  google_event_id: string | null
  google_calendar_connection_id: string | null
  google_sync_state: string | null
  google_sync_version: number
  google_sync_attempts: number
  contact: { name: string | null; phone: string | null } | null
  product: { name: string | null; attributes: Record<string, unknown> | null } | null
  service: { name: string | null } | null
  workspace: {
    id: string
    timezone: string
    locale: 'es' | 'en'
    industry: string
    settings: WorkspaceSettings | null
    address: string | null
    city: string | null
  } | null
}

const BOOKING_SELECT = {
  id: true,
  workspace_id: true,
  staff_id: true,
  contact_id: true,
  conversation_id: true,
  status: true,
  booking_date: true,
  booking_time: true,
  duration_minutes: true,
  customer_name: true,
  notes: true,
  google_event_id: true,
  google_calendar_connection_id: true,
  google_sync_state: true,
  google_sync_version: true,
  google_sync_attempts: true,
  contacts: { select: { name: true, phone: true } },
  products: { select: { name: true, attributes: true } },
  services: { select: { name: true } },
  workspaces: { select: { id: true, timezone: true, locale: true, industry: true, settings: true, address: true, city: true } },
} as const

function errText(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 500)
}

async function connectionById(workspaceId: string, id: string): Promise<CalendarConnection | null> {
  const data = await tenantDb(workspaceId)
    .calendar_connections.findFirst({ select: CONNECTION_SELECT, where: { id } })
    .catch(() => null)
  return (data as CalendarConnection | null) ?? null
}

async function connectionForStaff(workspaceId: string, staffId: string | null): Promise<CalendarConnection | null> {
  if (!staffId) return null
  const data = await tenantDb(workspaceId)
    .calendar_connections.findFirst({ select: CONNECTION_SELECT, where: { staff_id: staffId, status: { not: 'revoked' } } })
    .catch(() => null)
  return (data as CalendarConnection | null) ?? null
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

/** Where the visit happens: the property's address/zone, else the business address. */
export function bookingLocation(b: Pick<BookingForSync, 'product' | 'workspace'>): string | null {
  const a = b.product?.attributes ?? {}
  const fromProduct = [str(a.address), str(a.zone)].filter(Boolean)
  if (fromProduct.length) return [...new Set([...fromProduct, b.workspace?.city ?? null].filter(Boolean))].join(', ')
  return [b.workspace?.address, b.workspace?.city].filter(Boolean).join(', ') || null
}

function payloadFor(b: BookingForSync): { body: Record<string, unknown>; withMeet: boolean } {
  const ws = b.workspace!
  const locale = ws.locale === 'en' ? 'en' : 'es'
  const google = (ws.settings?.google ?? {}) as { add_meet?: boolean }
  const withMeet = google.add_meet === true
  const body = buildEventPayload({
    bookingId: b.id,
    workspaceId: b.workspace_id,
    date: b.booking_date,
    time: b.booking_time,
    durationMinutes: b.duration_minutes ?? 30,
    timeZone: safeTimeZone(ws.timezone),
    status: b.status,
    locale,
    bookingLabel: industryLabel(ws.industry, 'booking', locale, ws.settings),
    title: b.product?.name ?? b.service?.name ?? null,
    customerName: b.customer_name || b.contact?.name || null,
    customerPhone: b.contact?.phone ?? null,
    notes: b.notes,
    location: bookingLocation(b),
    conversationUrl: b.conversation_id ? `${siteUrl()}/inbox?c=${b.conversation_id}` : null,
    addMeet: withMeet,
    meetRequestId: `${b.id}-${b.google_sync_version}`,
  })
  return { body, withMeet }
}

/** Creates or updates the event; recreates it when it vanished. */
async function upsertEvent(conn: CalendarConnection, b: BookingForSync): Promise<string> {
  const { body, withMeet } = payloadFor(b)
  const sameCalendar = b.google_event_id && b.google_calendar_connection_id === conn.id
  const eventId = sameCalendar ? b.google_event_id! : eventIdFor(b.id)
  if (sameCalendar) {
    try {
      // conferenceData only on creation: never replace an existing Meet.
      const { conferenceData: _meet, ...patch } = body
      void _meet
      await patchEvent(conn, eventId, patch, false)
      return eventId
    } catch (err) {
      if (!(err instanceof GoogleApiError && (err.status === 404 || err.status === 410))) throw err
    }
  }
  try {
    await insertEvent(conn, { ...body, id: eventId }, withMeet)
  } catch (err) {
    // 409: an event with this id exists (e.g. deleted before) → restore it.
    if (!(err instanceof GoogleApiError && err.status === 409)) throw err
    const { conferenceData: _meet, ...patch } = body
    void _meet
    await patchEvent(conn, eventId, patch, false)
  }
  return eventId
}

/** Pushes one booking to Google. Returns the resulting state. */
export async function syncBooking(bookingId: string, workspaceId?: string): Promise<'synced' | 'skipped' | 'error'> {
  // Platform read (the workspace may be unknown); writes go through the tenant client.
  const row = await prisma.bookings
    .findFirst({ select: BOOKING_SELECT, where: { id: bookingId, ...(workspaceId ? { workspace_id: workspaceId } : {}) } })
    .catch(() => null)
  const b: BookingForSync | null = row
    ? (({ contacts, products, services, workspaces, ...rest }) => ({
        ...rest,
        status: rest.status as string,
        contact: contacts,
        product: products as BookingForSync['product'],
        service: services,
        workspace: workspaces as BookingForSync['workspace'],
      }))(row)
    : null
  if (!b || !b.workspace) return 'skipped'
  const db = tenantDb(b.workspace_id)
  if (b.google_sync_state !== 'pending' && b.google_sync_state !== 'error') return 'skipped'
  const version = b.google_sync_version

  try {
    const target = DROP_EVENT.has(b.status) ? null : await connectionForStaff(b.workspace_id, b.staff_id)
    let eventId = b.google_event_id
    let connId = b.google_calendar_connection_id

    // Event lives in another calendar (staff changed) or must go away.
    if (eventId && connId && (DROP_EVENT.has(b.status) || connId !== target?.id)) {
      const old = await connectionById(b.workspace_id, connId)
      if (old && old.status !== 'revoked') await deleteEvent(old, eventId)
      eventId = null
      connId = null
    }
    if (target && !DROP_EVENT.has(b.status)) {
      eventId = await upsertEvent(target, { ...b, google_event_id: eventId, google_calendar_connection_id: connId })
      connId = target.id
      invalidateStaffBusy(target.id)
    }

    const now = new Date().toISOString()
    await db.bookings
      .updateMany({ where: { id: b.id }, data: { google_event_id: eventId, google_calendar_connection_id: connId, google_synced_at: now } })
      .catch(() => undefined)
    await db.bookings
      .updateMany({
        where: { id: b.id, google_sync_version: version },
        data: { google_sync_state: eventId ? 'synced' : null, google_sync_error: null, google_sync_attempts: 0, google_synced_at: new Date(Date.now() + 1).toISOString() },
      })
      .catch(() => undefined)
    return 'synced'
  } catch (err) {
    console.warn(`[google] sync of booking ${b.id} failed:`, errText(err))
    await db.bookings
      .updateMany({
        where: { id: b.id, google_sync_version: version },
        data: {
          google_sync_state: 'error',
          google_sync_error: errText(err),
          google_sync_attempts: b.google_sync_attempts + 1,
          google_synced_at: new Date().toISOString(),
        },
      })
      .catch(() => undefined)
    return 'error'
  }
}

/** Pending bookings of a workspace (or all), oldest first. */
export async function syncPendingBookings(workspaceId?: string, limit = 25): Promise<{ synced: number; failed: number }> {
  // Platform query: one workspace or all of them (cron).
  const data = await prisma.bookings
    .findMany({
      select: { id: true, workspace_id: true },
      where: { google_sync_state: 'pending', ...(workspaceId ? { workspace_id: workspaceId } : {}) },
      orderBy: { updated_at: 'asc' },
      take: limit,
    })
    .catch(() => null)
  let synced = 0
  let failed = 0
  for (const row of data ?? []) {
    const r = await syncBooking(row.id, row.workspace_id)
    if (r === 'synced') synced++
    else if (r === 'error') failed++
  }
  return { synced, failed }
}

/** Run `fn` after the response when inside a request, else in background. */
export function runAfterResponse(fn: () => Promise<unknown>) {
  const task = () => fn().catch((err) => console.warn('[google] background task failed:', errText(err)))
  try {
    after(task)
  } catch {
    void task()
  }
}

/** Fire-and-forget push of one booking (AI booking, manual change). */
export function scheduleBookingSync(bookingId: string, workspaceId: string) {
  runAfterResponse(() => syncBooking(bookingId, workspaceId))
}

// ------------------------------------------------------------
// Deleted bookings
// ------------------------------------------------------------
export async function processEventDeletions(limit = 25, workspaceId?: string): Promise<{ deleted: number; failed: number }> {
  // Platform query: one workspace or all of them (cron).
  const data = await prisma.calendar_event_deletions
    .findMany({
      select: { id: true, workspace_id: true, connection_id: true, google_event_id: true, attempts: true },
      where: { attempts: { lt: MAX_ATTEMPTS }, ...(workspaceId ? { workspace_id: workspaceId } : {}) },
      orderBy: { created_at: 'asc' },
      take: limit,
    })
    .catch(() => null)
  let deleted = 0
  let failed = 0
  for (const row of data ?? []) {
    const conn = await connectionById(row.workspace_id, row.connection_id)
    const db = tenantDb(row.workspace_id)
    try {
      if (conn && conn.status !== 'revoked') await deleteEvent(conn, row.google_event_id)
      await db.calendar_event_deletions.deleteMany({ where: { id: row.id } }).catch(() => undefined)
      if (conn) invalidateStaffBusy(conn.id)
      deleted++
    } catch (err) {
      await db.calendar_event_deletions
        .updateMany({ where: { id: row.id }, data: { attempts: row.attempts + 1, last_error: errText(err) } })
        .catch(() => undefined)
      failed++
    }
  }
  return { deleted, failed }
}

// ------------------------------------------------------------
// Inbound: Google → bookings
// ------------------------------------------------------------
interface InboundBooking {
  id: string
  workspace_id: string
  contact_id: string | null
  conversation_id: string | null
  customer_name: string | null
  status: string
  booking_date: string
  booking_time: string
  duration_minutes: number | null
  google_event_id: string | null
}

async function notifyCustomer(b: InboundBooking, text: string, event: string) {
  const metadata = { booking_id: b.id, event }
  try {
    if (b.conversation_id) {
      await sendMessage({ workspaceId: b.workspace_id, conversationId: b.conversation_id, content: { type: 'text', text }, sender: { type: 'bot' }, metadata })
    } else if (b.contact_id) {
      await sendToContact({ workspaceId: b.workspace_id, contactId: b.contact_id, content: { type: 'text', text }, metadata })
    }
  } catch (err) {
    console.warn(`[google] could not notify the customer of booking ${b.id}:`, errText(err))
  }
}

export interface InboundResult {
  moved: number
  cancelled: number
}

/** Applies changed events of one connection to their bookings. */
export async function applyInboundEvents(conn: CalendarConnection, events: GoogleEvent[]): Promise<InboundResult> {
  const result: InboundResult = { moved: 0, cancelled: 0 }
  if (!events.length) return result
  const db = tenantDb(conn.workspace_id)
  const ids = [...new Set(events.map((e) => e.id))]
  // Only bookings whose event we created in THIS calendar: a copied
  // booking_id in someone else's event can't touch a booking.
  const rows = await db.bookings
    .findMany({
      select: {
        id: true,
        workspace_id: true,
        contact_id: true,
        conversation_id: true,
        customer_name: true,
        status: true,
        booking_date: true,
        booking_time: true,
        duration_minutes: true,
        google_event_id: true,
      },
      where: { google_calendar_connection_id: conn.id, google_event_id: { in: ids } },
    })
    .catch(() => null)
  if (!rows?.length) return result

  const ws = await db.workspaces
    .findFirst({ select: { id: true, timezone: true, locale: true, industry: true, settings: true }, where: { id: conn.workspace_id } })
    .catch(() => null)
  if (!ws) return result
  const timeZone = safeTimeZone(ws.timezone)
  const locale: 'es' | 'en' = ws.locale === 'en' ? 'en' : 'es'
  const noun = industryLabel(ws.industry, 'booking', locale, ws.settings as WorkspaceSettings).toLowerCase()
  const today = zonedNow(timeZone).date

  for (const ev of events) {
    const b = (rows as InboundBooking[]).find((r) => r.google_event_id === ev.id)
    if (!b) continue
    const owner = ev.extendedProperties?.private?.booking_id
    if (owner && owner !== b.id) continue
    const change = mapInboundEvent(ev, b, timeZone)
    const now = new Date().toISOString()
    if (change.kind === 'moved') {
      const updated = await db.bookings
        .updateMany({
          where: { id: b.id, booking_date: b.booking_date, booking_time: b.booking_time, status: { in: [...ACTIVE] } },
          data: {
            booking_date: change.date,
            booking_time: change.time,
            duration_minutes: change.durationMinutes,
            google_sync_state: 'synced',
            google_sync_error: null,
            google_synced_at: now,
          },
        })
        .catch(() => null)
      if (!updated?.count) continue
      result.moved++
      const startChanged = change.date !== b.booking_date || change.time !== b.booking_time.slice(0, 5)
      if (startChanged && change.date >= today) {
        await notifyCustomer(b, rescheduledText({ locale, booking: noun, customerName: b.customer_name, date: change.date, time: change.time }), 'google_rescheduled')
      }
    } else if (change.kind === 'cancelled') {
      const updated = await db.bookings
        .updateMany({
          where: { id: b.id, status: { in: [...ACTIVE] } },
          data: { status: 'cancelled', google_event_id: null, google_calendar_connection_id: null, google_sync_state: null, google_synced_at: now },
        })
        .catch(() => null)
      if (!updated?.count) continue
      result.cancelled++
      if (b.booking_date >= today) {
        await notifyCustomer(b, cancelledText({ locale, booking: noun, customerName: b.customer_name, date: b.booking_date, time: b.booking_time.slice(0, 5) }), 'google_cancelled')
      }
    }
  }
  if (result.moved || result.cancelled) {
    const { invalidateBusinessContext } = await import('@/lib/ai/context')
    invalidateBusinessContext(conn.workspace_id)
  }
  return result
}

/** Window of the full (re)sync listing. */
const FULL_SYNC_LOOKBACK_MS = 24 * 3600_000
const MAX_PAGES = 20

/**
 * Incremental sync with the stored syncToken; a missing or expired (410)
 * token triggers a full listing from yesterday on, whose events are
 * reconciled too.
 */
export async function syncConnectionChanges(conn: CalendarConnection): Promise<InboundResult & { full: boolean }> {
  const db = tenantDb(conn.workspace_id)
  const secrets = await loadSecrets(conn)
  if (!secrets) throw new Error('connection has no tokens')
  let syncToken = secrets.sync_token
  let full = !syncToken
  const events: GoogleEvent[] = []
  let nextSyncToken: string | undefined
  let pageToken: string | undefined
  for (let page = 0; page < MAX_PAGES; page++) {
    let res
    try {
      res = await listEvents(conn, syncToken ? { syncToken, pageToken } : { timeMin: new Date(Date.now() - FULL_SYNC_LOOKBACK_MS).toISOString(), pageToken })
    } catch (err) {
      if (err instanceof GoogleApiError && err.status === 410 && syncToken) {
        syncToken = null
        full = true
        pageToken = undefined
        events.length = 0
        continue
      }
      throw err
    }
    events.push(...(res?.items ?? []))
    if (res?.nextPageToken) {
      pageToken = res.nextPageToken
      continue
    }
    nextSyncToken = res?.nextSyncToken
    break
  }
  const result = await applyInboundEvents(conn, events)
  if (nextSyncToken) {
    await db.calendar_connection_secrets
      .updateMany({ where: { connection_id: conn.id }, data: { sync_token: nextSyncToken, updated_at: new Date().toISOString() } })
      .catch(() => undefined)
  }
  await markConnection(conn, { last_synced_at: new Date().toISOString(), last_error: null, ...(conn.status === 'error' ? { status: 'active' } : {}) })
  invalidateStaffBusy(conn.id)
  return { ...result, full }
}

// ------------------------------------------------------------
// Push channels
// ------------------------------------------------------------
const WATCH_TTL_SECONDS = 7 * 24 * 3600

/** Opens a new events.watch channel (and stops the previous one). */
export async function setupWatch(conn: CalendarConnection): Promise<boolean> {
  if (!pushSupported()) return false
  const id = crypto.randomUUID()
  const token = crypto.randomBytes(32).toString('base64url')
  const db = tenantDb(conn.workspace_id)
  // Store the token first so an immediate 'sync' notification validates.
  await db.calendar_connection_secrets.updateMany({ where: { connection_id: conn.id }, data: { watch_token: token } }).catch(() => undefined)
  const prev = conn.watch_channel_id && conn.watch_resource_id ? { id: conn.watch_channel_id, resourceId: conn.watch_resource_id } : null
  await markConnection(conn, { watch_channel_id: id, watch_resource_id: null })
  const res = await watchEvents(conn, { id, token, address: webhookUrl(), ttlSeconds: WATCH_TTL_SECONDS })
  const expires = res?.expiration ? new Date(Number(res.expiration)).toISOString() : new Date(Date.now() + WATCH_TTL_SECONDS * 1000).toISOString()
  await markConnection(conn, { watch_channel_id: id, watch_resource_id: res?.resourceId ?? null, watch_expires_at: expires })
  Object.assign(conn, { watch_channel_id: id, watch_resource_id: res?.resourceId ?? null, watch_expires_at: expires })
  if (prev) await stopChannel(conn, prev.id, prev.resourceId).catch((err) => console.warn('[google] stop old channel:', errText(err)))
  return true
}

/** Stops the push channel, revokes the grant and removes the connection. */
export async function disconnectConnection(conn: CalendarConnection): Promise<void> {
  const db = tenantDb(conn.workspace_id)
  const secrets = await loadSecrets(conn)
  if (conn.watch_channel_id && conn.watch_resource_id && conn.status !== 'revoked') {
    await stopChannel(conn, conn.watch_channel_id, conn.watch_resource_id).catch((err) => console.warn('[google] stop channel:', errText(err)))
  }
  if (secrets) {
    const { decrypt } = await import('@/lib/whatsapp/encryption')
    try {
      await revokeToken(decrypt(secrets.refresh_token))
    } catch (err) {
      console.warn('[google] revoke:', errText(err))
    }
  }
  // Events stay in the advisor's calendar; bookings just forget them.
  await db.bookings
    .updateMany({
      where: { google_calendar_connection_id: conn.id },
      data: { google_event_id: null, google_calendar_connection_id: null, google_sync_state: null, google_sync_error: null, google_synced_at: new Date().toISOString() },
    })
    .catch(() => undefined)
  await db.calendar_connections.deleteMany({ where: { id: conn.id } }).catch(() => undefined)
  invalidateStaffBusy(conn.id)
}

/** Queues the staff member's upcoming active bookings for a first push. */
export async function queueUpcomingBookings(conn: CalendarConnection, timeZone: string): Promise<number> {
  const db = tenantDb(conn.workspace_id)
  const today = zonedNow(safeTimeZone(timeZone)).date
  const data = await db.bookings
    .findMany({
      select: { id: true, google_sync_version: true },
      where: { staff_id: conn.staff_id, booking_date: { gte: today }, status: { in: [...ACTIVE] } },
      take: 200,
    })
    .catch(() => null)
  for (const row of data ?? []) {
    await db.bookings
      .updateMany({ where: { id: row.id }, data: { google_sync_state: 'pending', google_sync_attempts: 0, google_sync_version: (row.google_sync_version ?? 0) + 1 } })
      .catch(() => undefined)
  }
  return data?.length ?? 0
}

// ------------------------------------------------------------
// Cron
// ------------------------------------------------------------
const POLL_UNWATCHED_MS = 5 * 60_000
const POLL_WATCHED_MS = 6 * 3600_000
const RENEW_BEFORE_MS = 24 * 3600_000

/** Backoff for failed pushes: 1, 2, 4 … 60 minutes. */
export function retryDelayMs(attempts: number): number {
  return Math.min(60, 2 ** Math.max(0, attempts - 1)) * 60_000
}

export async function runGoogleCalendarCron() {
  // Cron across every workspace: platform client.
  const db = prisma
  const now = Date.now()
  const out = { watchesRenewed: 0, polled: 0, moved: 0, cancelled: 0, pushed: 0, retried: 0, failed: 0, deletions: 0, errors: [] as string[] }

  const conns = await db.calendar_connections
    .findMany({ select: CONNECTION_SELECT, where: { status: { in: ['active', 'error'] } }, take: 500 })
    .catch(() => null)
  for (const conn of (conns ?? []) as CalendarConnection[]) {
    try {
      const watched = !!conn.watch_channel_id && !!conn.watch_expires_at && new Date(conn.watch_expires_at).getTime() > now
      if (pushSupported() && (!watched || new Date(conn.watch_expires_at!).getTime() - now < RENEW_BEFORE_MS)) {
        if (await setupWatch(conn)) out.watchesRenewed++
      }
      const last = conn.last_synced_at ? new Date(conn.last_synced_at).getTime() : 0
      const isWatched = pushSupported() && !!conn.watch_channel_id
      if (now - last >= (isWatched ? POLL_WATCHED_MS : POLL_UNWATCHED_MS)) {
        const r = await syncConnectionChanges(conn)
        out.polled++
        out.moved += r.moved
        out.cancelled += r.cancelled
      }
    } catch (err) {
      out.errors.push(`${conn.id}: ${errText(err)}`)
      // Transient: keep the connection usable and show the error. A
      // revoked grant was already flagged by getAccessToken.
      if (conn.status !== 'revoked') await markConnection(conn, { last_error: errText(err) })
    }
  }

  const pending = await syncPendingBookings(undefined, 50)
  out.pushed = pending.synced
  out.failed += pending.failed

  const failed = await db.bookings
    .findMany({
      select: { id: true, workspace_id: true, google_sync_attempts: true, google_synced_at: true },
      where: { google_sync_state: 'error', google_sync_attempts: { lt: MAX_ATTEMPTS } },
      take: 50,
    })
    .catch(() => null)
  for (const row of failed ?? []) {
    const last = row.google_synced_at ? new Date(row.google_synced_at).getTime() : 0
    if (now - last < retryDelayMs(row.google_sync_attempts)) continue
    const r = await syncBooking(row.id, row.workspace_id)
    if (r === 'synced') out.retried++
    else if (r === 'error') out.failed++
  }

  out.deletions = (await processEventDeletions(50)).deleted
  return out
}

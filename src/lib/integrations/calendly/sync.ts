import 'server-only'
import { prisma } from '@/lib/db/prisma'
import { tenantDb } from '@/lib/db/tenant'
import { safeTimeZone } from '@/lib/ai/time'
import { invalidateBusinessContext } from '@/lib/ai/context'
import { findOrCreateContactByPhone } from '@/lib/messaging/conversations'
import { getCalendlyConfig } from './config'
import { calendlyWebhookUrl } from './endpoints'
import {
  CalendlyApiError, cancelScheduledEvent, createWebhook, deleteWebhook, exchangeCode, getMe, getScheduledEvent,
  listEventTypes, listInvitees, listScheduledEvents, revokeToken, saveTokens, getAccessToken,
} from './api'
import { bookingFromInvitee, type CalendlyInvitee, type CalendlyScheduledEvent } from './model'

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** OAuth callback: stores the connection of the workspace, its event types, and the webhook when the plan allows. */
export async function completeCalendlyConnect(input: { workspaceId: string; userId: string; code: string }) {
  const tokens = await exchangeCode(input.code)
  const me = await getMe({ token: tokens.access_token })

  const previous = await prisma.calendly_connections.findUnique({ where: { workspace_id: input.workspaceId }, select: { id: true, webhook_uri: true } })
  if (previous) await disconnectCalendly(input.workspaceId, { revoke: false })

  const connection = await prisma.calendly_connections.create({
    data: {
      workspace_id: input.workspaceId,
      user_uri: me.uri,
      organization_uri: me.current_organization ?? tokens.organization ?? null,
      email: me.email,
      name: me.name,
      scheduling_url: me.scheduling_url,
      connected_by: input.userId,
    },
    select: { id: true },
  })
  await saveTokens(connection.id, tokens)
  await syncEventTypes(connection.id).catch((e) => console.error('[calendly] event types sync failed:', message(e)))
  await ensureWebhook(connection.id).catch((e) => console.error('[calendly] webhook setup failed:', message(e)))
  return connection.id
}

/** Refreshes the workspace's list of Calendly event types, keeping the service/staff each one is linked to. */
export async function syncEventTypes(connectionId: string) {
  const c = await prisma.calendly_connections.findUniqueOrThrow({ where: { id: connectionId }, select: { workspace_id: true, user_uri: true } })
  const types = await listEventTypes({ connectionId }, c.user_uri)
  const seen = new Set<string>()
  for (const et of types) {
    seen.add(et.uri)
    const data = {
      name: et.name,
      duration_minutes: et.duration ?? null,
      scheduling_url: et.scheduling_url ?? null,
      active: et.active !== false,
      locations: (et.locations ?? []).map((l) => l.kind).filter(Boolean),
      updated_at: new Date(),
    }
    await prisma.calendly_event_types.upsert({
      where: { connection_id_uri: { connection_id: connectionId, uri: et.uri } },
      create: { workspace_id: c.workspace_id, connection_id: connectionId, uri: et.uri, ...data },
      update: data,
    })
  }
  // Event types deleted in Calendly stop being bookable here.
  await prisma.calendly_event_types.updateMany({ where: { connection_id: connectionId, uri: { notIn: [...seen] } }, data: { active: false } })
  invalidateBusinessContext(c.workspace_id)
}

/** Subscribes to invitee.created / invitee.canceled. Plans without webhooks are polled instead. */
export async function ensureWebhook(connectionId: string) {
  const c = await prisma.calendly_connections.findUniqueOrThrow({ where: { id: connectionId }, select: { user_uri: true, organization_uri: true, webhook_uri: true } })
  const cfg = await getCalendlyConfig()
  if (c.webhook_uri || !c.organization_uri || !cfg?.webhookSigningKey || !calendlyWebhookUrl().startsWith('https://')) return
  try {
    const uri = await createWebhook({ connectionId }, { url: calendlyWebhookUrl(), organization: c.organization_uri, user: c.user_uri })
    await prisma.calendly_connections.update({ where: { id: connectionId }, data: { webhook_uri: uri, webhooks_available: true } })
  } catch (err) {
    // 409: a subscription for this URL already exists (e.g. after reconnecting).
    if (err instanceof CalendlyApiError && err.status === 409) {
      await prisma.calendly_connections.update({ where: { id: connectionId }, data: { webhooks_available: true } })
      return
    }
    if (err instanceof CalendlyApiError && err.planLimited) {
      await prisma.calendly_connections.update({ where: { id: connectionId }, data: { webhooks_available: false } })
      return
    }
    throw err
  }
}

export async function disconnectCalendly(workspaceId: string, opts: { revoke?: boolean } = {}) {
  const c = await prisma.calendly_connections.findUnique({ where: { workspace_id: workspaceId }, select: { id: true, webhook_uri: true } })
  if (!c) return
  if (c.webhook_uri) await deleteWebhook({ connectionId: c.id }, c.webhook_uri).catch(() => {})
  if (opts.revoke !== false) {
    const token = await getAccessToken(c.id).catch(() => null)
    if (token) await revokeToken(token)
  }
  await prisma.calendly_connections.delete({ where: { id: c.id } })
  invalidateBusinessContext(workspaceId)
}

// ---------------------------------------------------------------- inbound

async function findOrCreateContact(workspaceId: string, invitee: CalendlyInvitee): Promise<string | null> {
  const db = tenantDb(workspaceId)
  if (invitee.email) {
    const byEmail = await db.contacts.findFirst({ where: { email: { equals: invitee.email, mode: 'insensitive' } }, select: { id: true } })
    if (byEmail) return byEmail.id
  }
  if (invitee.text_reminder_number) {
    const id = await findOrCreateContactByPhone(workspaceId, invitee.text_reminder_number, invitee.name)
    if (id) {
      if (invitee.email) await db.contacts.updateMany({ where: { id, email: null }, data: { email: invitee.email } })
      return id
    }
  }
  const created = await db.contacts.create({
    data: { workspace_id: workspaceId, name: invitee.name || invitee.email || 'Calendly', email: invitee.email },
    select: { id: true },
  })
  return created.id
}

/**
 * Creates or updates the Whasalia booking of a Calendly invitee. Bookings the
 * AI made through the API are found by invitee URI and only updated.
 */
export async function upsertFromInvitee(workspaceId: string, invitee: CalendlyInvitee, event: CalendlyScheduledEvent) {
  const db = tenantDb(workspaceId)
  const ws = await prisma.workspaces.findUnique({ where: { id: workspaceId }, select: { timezone: true } })
  const fields = bookingFromInvitee(invitee, event, safeTimeZone(ws?.timezone ?? 'UTC'))
  const existing = await db.bookings.findFirst({ where: { calendly_invitee_uri: invitee.uri }, select: { id: true, status: true } })
  if (existing) {
    await db.bookings.update({
      where: { id: existing.id },
      data: {
        booking_date: fields.booking_date,
        booking_time: fields.booking_time,
        duration_minutes: fields.duration_minutes,
        status: fields.status === 'cancelled' ? 'cancelled' : existing.status === 'cancelled' ? 'cancelled' : existing.status,
        calendly_cancel_url: fields.calendly_cancel_url,
        calendly_reschedule_url: fields.calendly_reschedule_url,
        // A cancellation that came from Calendly needs no push back.
        ...(fields.status === 'cancelled' ? { calendly_cancel_synced_at: new Date() } : {}),
      },
    })
    invalidateBusinessContext(workspaceId)
    return { id: existing.id, created: false }
  }
  if (fields.status === 'cancelled') return null

  const mapping = await prisma.calendly_event_types.findFirst({ where: { workspace_id: workspaceId, uri: event.event_type }, select: { service_id: true, staff_id: true } })
  const contactId = await findOrCreateContact(workspaceId, invitee)
  if (!contactId) return null
  try {
    const b = await db.bookings.create({
      data: {
        workspace_id: workspaceId,
        contact_id: contactId,
        service_id: mapping?.service_id ?? null,
        staff_id: mapping?.staff_id ?? null,
        ...fields,
        custom_fields: {},
        source: 'calendly',
      },
      select: { id: true },
    })
    invalidateBusinessContext(workspaceId)
    return { id: b.id, created: true }
  } catch (err) {
    // Unique (workspace, invitee): the webhook and the poll raced; the other one created it.
    if (/unique|P2002/i.test(message(err))) return null
    throw err
  }
}

/** Handles one verified webhook delivery. */
export async function handleWebhook(body: { event?: string; payload?: CalendlyInvitee & { scheduled_event?: CalendlyScheduledEvent } }) {
  const payload = body.payload
  if (!payload?.uri || !payload.scheduled_event?.event_type) return { ok: false, reason: 'payload' }
  const et = await prisma.calendly_event_types.findFirst({ where: { uri: payload.scheduled_event.event_type }, select: { workspace_id: true } })
  if (!et) return { ok: false, reason: 'unknown_event_type' }
  const invitee: CalendlyInvitee = { ...payload, status: body.event === 'invitee.canceled' ? 'canceled' : payload.status ?? 'active' }
  await upsertFromInvitee(et.workspace_id, invitee, payload.scheduled_event)
  return { ok: true }
}

/** Reconciles upcoming and recent Calendly events of a connection (plans without webhooks, and as a safety net). */
export async function pollConnection(connectionId: string) {
  const c = await prisma.calendly_connections.findUniqueOrThrow({ where: { id: connectionId }, select: { workspace_id: true, user_uri: true } })
  const minStart = new Date(Date.now() - 86400_000).toISOString()
  const maxStart = new Date(Date.now() + 90 * 86400_000).toISOString()
  for (const status of ['active', 'canceled'] as const) {
    const events = await listScheduledEvents({ connectionId }, c.user_uri, { minStart, maxStart, status })
    for (const ev of events) {
      const invitees = await listInvitees({ connectionId }, ev.uri)
      for (const inv of invitees) await upsertFromInvitee(c.workspace_id, { ...inv, status: status === 'canceled' ? 'canceled' : inv.status }, { ...ev, status })
    }
  }
  await prisma.calendly_connections.update({ where: { id: connectionId }, data: { last_synced_at: new Date(), status: 'active', last_error: null } })
}

/** Sends cancellations made in Whasalia (dashboard, AI, API) to Calendly. */
export async function pushCancellations(workspaceId?: string) {
  const pending = await prisma.bookings.findMany({
    where: { status: 'cancelled', calendly_event_uri: { not: null }, calendly_cancel_synced_at: null, ...(workspaceId ? { workspace_id: workspaceId } : {}) },
    select: { id: true, workspace_id: true, calendly_event_uri: true },
    take: 50,
  })
  for (const b of pending) {
    const c = await prisma.calendly_connections.findUnique({ where: { workspace_id: b.workspace_id }, select: { id: true, status: true } })
    if (!c || c.status === 'revoked') continue
    try {
      const ev = await getScheduledEvent({ connectionId: c.id }, b.calendly_event_uri!)
      if (ev.status !== 'canceled') await cancelScheduledEvent({ connectionId: c.id }, b.calendly_event_uri!, 'Cancelado desde Whasalia')
      await prisma.bookings.update({ where: { id: b.id }, data: { calendly_cancel_synced_at: new Date() } })
    } catch (err) {
      console.error('[calendly] cancel push failed:', message(err))
    }
  }
}

/** Cron (every 5 min): poll connections without webhooks (and every 6 h the rest), push cancellations, refresh event types daily. */
export async function runCalendlyCron() {
  const connections = await prisma.calendly_connections.findMany({ where: { status: { not: 'revoked' } }, select: { id: true, webhook_uri: true, last_synced_at: true } })
  let polled = 0
  for (const c of connections) {
    const last = c.last_synced_at ? new Date(c.last_synced_at).getTime() : 0
    const every = c.webhook_uri ? 6 * 3600_000 : 5 * 60_000
    if (Date.now() - last < every - 30_000) continue
    try {
      if (Date.now() - last > 24 * 3600_000) await syncEventTypes(c.id)
      await pollConnection(c.id)
      polled++
    } catch (err) {
      await prisma.calendly_connections.update({ where: { id: c.id }, data: { status: 'error', last_error: message(err).slice(0, 300) } }).catch(() => {})
    }
  }
  await pushCancellations()
  return { connections: connections.length, polled }
}

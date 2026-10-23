import 'server-only'
import { prisma } from '@/lib/db/prisma'
import { tenantDb } from '@/lib/db/tenant'
import { addDays, zonedNow } from '@/lib/ai/time'
import { CalendlyApiError, availableTimes, createInvitee } from './api'
import { inviteeLocation, prefilledLink, slotsByDate, utcInstant, type AvailableTime } from './model'

// Bookings of services linked to a Calendly event type: the AI offers
// Calendly's free times and books through the API, or — when the plan
// can't book by API — sends the link of the chosen time.

export interface CalendlyServiceLink {
  connectionId: string
  eventTypeUri: string
  eventTypeName: string
  schedulingUrl: string | null
  staffId: string | null
  locations: string[]
  /** null = not tried yet; false = send links instead of booking. */
  canBook: boolean | null
}

/** service id → its Calendly event type, for the workspace's active connection. */
export async function loadCalendlyLinks(workspaceId: string): Promise<Record<string, CalendlyServiceLink>> {
  const rows = await prisma.calendly_event_types.findMany({
    where: { workspace_id: workspaceId, active: true, service_id: { not: null }, calendly_connections: { status: { not: 'revoked' } } },
    select: { uri: true, name: true, scheduling_url: true, staff_id: true, locations: true, service_id: true, connection_id: true, calendly_connections: { select: { can_book: true } } },
  })
  const out: Record<string, CalendlyServiceLink> = {}
  for (const r of rows) {
    out[r.service_id!] = {
      connectionId: r.connection_id,
      eventTypeUri: r.uri,
      eventTypeName: r.name,
      schedulingUrl: r.scheduling_url,
      staffId: r.staff_id,
      locations: Array.isArray(r.locations) ? (r.locations as string[]) : [],
      canBook: r.calendly_connections.can_book,
    }
  }
  return out
}

const SLOT_TTL_MS = 2 * 60_000
const slotCache = new Map<string, { at: number; times: AvailableTime[] }>()

/** Calendly free times of an event type between two local dates (inclusive), at most 7 days per request. */
export async function calendlyTimes(link: CalendlyServiceLink, from: string, to: string, timeZone: string, fresh = false): Promise<AvailableTime[]> {
  const key = `${link.eventTypeUri}|${from}|${to}`
  const hit = slotCache.get(key)
  if (!fresh && hit && Date.now() - hit.at < SLOT_TTL_MS) return hit.times
  const out: AvailableTime[] = []
  let start = from
  while (start <= to) {
    const end = addDays(start, 6) < to ? addDays(start, 6) : to
    const startIso = new Date(Math.max(Date.parse(utcInstant(start, '00:00', timeZone)), Date.now() + 60_000)).toISOString()
    const endIso = utcInstant(addDays(end, 1), '00:00', timeZone)
    if (Date.parse(endIso) > Date.parse(startIso)) out.push(...(await availableTimes({ connectionId: link.connectionId }, link.eventTypeUri, startIso, endIso)))
    start = addDays(end, 1)
  }
  slotCache.set(key, { at: Date.now(), times: out })
  return out
}

/** Free start times per local date for the prompt (next `days` days, or one date). */
export async function calendlySlotsForPrompt(link: CalendlyServiceLink, timeZone: string, date: string | null, days = 7): Promise<Record<string, string[]>> {
  const today = zonedNow(timeZone).date
  const from = date && date >= today ? date : today
  const to = date && date >= today ? date : addDays(today, days - 1)
  return slotsByDate(await calendlyTimes(link, from, to, timeZone), timeZone)
}

export type CalendlyBookingResult =
  | { ok: true; bookingId: string }
  | { ok: false; reason: 'slot_taken'; alternatives: string[] }
  | { ok: false; reason: 'closed' }
  | { ok: false; reason: 'missing'; missing: string[] }
  | { ok: false; reason: 'link'; url: string }

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/** Books `date time` of a Calendly-linked service (fresh availability), or returns the booking link. */
export async function bookWithCalendly(input: {
  workspaceId: string
  contactId: string
  conversationId: string | null
  aiAgentId: string | null
  serviceId: string
  link: CalendlyServiceLink
  date: string
  time: string
  customerName: string | null
  email: string | null
  timeZone: string
  durationMinutes: number
  partySize?: number | null
  fields?: Record<string, unknown>
  source?: string
}): Promise<CalendlyBookingResult> {
  const times = await calendlyTimes(input.link, input.date, input.date, input.timeZone, true)
  const byDate = slotsByDate(times, input.timeZone)
  const free = byDate[input.date] ?? []
  const slot = times.find((t) => t.status === 'available' && utcInstant(input.date, input.time, input.timeZone) === new Date(t.start_time).toISOString().replace('.000Z', 'Z'))
  if (!slot) return free.length ? { ok: false, reason: 'slot_taken', alternatives: free.slice(0, 6) } : { ok: false, reason: 'closed' }

  const db = tenantDb(input.workspaceId)
  const contact = await db.contacts.findFirst({ where: { id: input.contactId }, select: { name: true, email: true, phone: true } })
  const name = input.customerName || contact?.name || null
  const email = input.email && EMAIL.test(input.email) ? input.email.trim().toLowerCase() : contact?.email || null
  const linkFor = () => ({ ok: false as const, reason: 'link' as const, url: prefilledLink(slot.scheduling_url || input.link.schedulingUrl || '', { name, email }) })

  if (input.link.canBook === false) return linkFor()
  if (!email) return { ok: false, reason: 'missing', missing: ['email'] }
  const location = inviteeLocation(input.link.locations, contact?.phone ?? null)
  if (location === null) return linkFor()

  let created
  try {
    created = await createInvitee(
      { connectionId: input.link.connectionId },
      {
        event_type: input.link.eventTypeUri,
        start_time: new Date(slot.start_time).toISOString().replace('.000Z', 'Z'),
        invitee: { name: name || email, email, timezone: input.timeZone },
        ...(location ? { location } : {}),
      },
    )
  } catch (err) {
    if (err instanceof CalendlyApiError && err.planLimited) {
      await prisma.calendly_connections.update({ where: { id: input.link.connectionId }, data: { can_book: false } }).catch(() => {})
      return linkFor()
    }
    if (err instanceof CalendlyApiError && (err.status === 404 || err.status === 409)) {
      const again = slotsByDate(await calendlyTimes(input.link, input.date, input.date, input.timeZone, true), input.timeZone)[input.date] ?? []
      return again.length ? { ok: false, reason: 'slot_taken', alternatives: again.slice(0, 6) } : { ok: false, reason: 'closed' }
    }
    console.error('[calendly] booking failed, sending the link instead:', err instanceof Error ? err.message : err)
    return linkFor()
  }
  if (input.link.canBook !== true) await prisma.calendly_connections.update({ where: { id: input.link.connectionId }, data: { can_book: true } }).catch(() => {})
  if (email && !contact?.email) await db.contacts.updateMany({ where: { id: input.contactId, email: null }, data: { email } }).catch(() => {})

  const booking = await db.bookings.create({
    data: {
      workspace_id: input.workspaceId,
      contact_id: input.contactId,
      conversation_id: input.conversationId,
      ai_agent_id: input.aiAgentId,
      service_id: input.serviceId,
      staff_id: input.link.staffId,
      booking_date: input.date,
      booking_time: input.time,
      duration_minutes: input.durationMinutes,
      customer_name: name,
      party_size: input.partySize ?? null,
      custom_fields: (input.fields ?? {}) as object,
      status: 'confirmed',
      source: input.source ?? 'ai',
      calendly_event_uri: created.event,
      calendly_invitee_uri: created.uri,
      calendly_cancel_url: created.cancel_url,
      calendly_reschedule_url: created.reschedule_url,
    },
    select: { id: true },
  })
  return { ok: true, bookingId: booking.id }
}

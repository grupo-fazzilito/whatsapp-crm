import 'server-only'
import { tenantDb } from '@/lib/db/tenant'
import { getPreset, resolveIndustry } from '@/lib/industries'
import { freeSlotsForBusiness, freeSlotsForStaff } from './slots'
import { isIsoDate, zonedNow } from './time'
import { invalidateBusinessContext, loadBusinessContext } from './context'
import type { BookingDraft } from './types'
import { scheduleBookingSync } from '@/lib/integrations/google/sync'
import { bookWithCalendly } from '@/lib/integrations/calendly/booking'
import { pushCancellations } from '@/lib/integrations/calendly/sync'

export type BookingFailure =
  | { reason: 'missing'; missing: string[] }
  | { reason: 'slot_taken'; alternatives: string[] }
  | { reason: 'closed' }
  | { reason: 'past' }
  | { reason: 'invalid'; detail: string }
  /** Calendly can't book by API on this plan: the customer finishes on this link. */
  | { reason: 'link'; url: string }

export interface CreateBookingInput {
  workspaceId: string
  contactId: string
  conversationId: string | null
  aiAgentId: string | null
  draft: BookingDraft
  source: 'ai' | 'manual'
}

/** Required booking data still missing, per industry preset. */
export function missingBookingData(industry: string, draft: BookingDraft, hasServices: boolean, hasStaff: boolean): string[] {
  const preset = getPreset(industry)
  const missing: string[] = []
  if (hasServices && !draft.service_id) missing.push('service')
  if (preset.bookingNeedsStaff && hasStaff && !draft.staff_id) missing.push('staff')
  if (!isIsoDate(draft.date)) missing.push('date')
  if (!draft.time || !/^\d{1,2}:\d{2}$/.test(draft.time)) missing.push('time')
  for (const f of preset.bookingFields) {
    if (!f.required) continue
    if (f.key === 'customer_name' && !draft.customer_name) missing.push('customer_name')
    else if (f.key === 'party_size' && !draft.party_size) missing.push('party_size')
    else if (f.key === 'product_id' && !draft.product_id) missing.push('product')
    else if (!['customer_name', 'party_size', 'product_id'].includes(f.key) && !draft.fields?.[f.key]) missing.push(f.key)
  }
  return missing
}

/**
 * Validates the draft against live availability (fresh read) and creates
 * the booking. When no staff was chosen but the business has staff, the
 * first free staff member is assigned.
 */
export async function createBookingFromDraft(
  input: CreateBookingInput,
): Promise<{ ok: true; bookingId: string; staffName: string | null; serviceName: string | null } | ({ ok: false } & BookingFailure)> {
  const ctx = await loadBusinessContext(input.workspaceId, true)
  if (!ctx) return { ok: false, reason: 'invalid', detail: 'workspace' }
  const { draft } = input
  const { modules } = resolveIndustry(ctx.workspace.industry, ctx.workspace.settings)
  const hasServices = modules.services && ctx.services.length > 0
  const hasStaff = modules.staff && ctx.staff.length > 0

  // Services booked in Calendly take the staff member from the event type.
  const calendly = draft.service_id ? ctx.calendly?.[draft.service_id] : undefined
  const missing = missingBookingData(ctx.workspace.industry, draft, hasServices, !calendly && hasStaff && getPreset(ctx.workspace.industry).bookingNeedsStaff)
  if (missing.length) return { ok: false, reason: 'missing', missing }

  const now = zonedNow(ctx.timeZone)
  const date = draft.date!
  const time = draft.time!.padStart(5, '0')
  if (date < now.date || (date === now.date && time <= now.time)) return { ok: false, reason: 'past' }

  const service = hasServices ? ctx.services.find((s) => s.id === draft.service_id) : undefined
  if (hasServices && !service) return { ok: false, reason: 'invalid', detail: 'service' }
  const duration = service?.duration_minutes ?? 30

  if (calendly && service) {
    const email = typeof draft.fields?.email === 'string' ? draft.fields.email : null
    const r = await bookWithCalendly({
      workspaceId: input.workspaceId, contactId: input.contactId, conversationId: input.conversationId, aiAgentId: input.aiAgentId,
      serviceId: service.id, link: calendly, date, time, customerName: draft.customer_name ?? null, email, timeZone: ctx.timeZone,
      durationMinutes: duration, partySize: draft.party_size ?? null, fields: draft.fields ?? {},
    })
    if (!r.ok) return r
    invalidateBusinessContext(input.workspaceId)
    if (calendly.staffId) scheduleBookingSync(r.bookingId, input.workspaceId)
    const staffName = calendly.staffId ? ctx.staff.find((s) => s.id === calendly.staffId)?.name ?? null : null
    return { ok: true, bookingId: r.bookingId, staffName, serviceName: service.name }
  }
  const q = {
    hours: ctx.hours,
    exceptions: ctx.exceptions,
    bookings: ctx.bookings,
    today: now.date,
    nowTime: now.time,
    durationMinutes: duration,
    stepMinutes: 15,
    capacity: Number(ctx.workspace.settings?.booking_capacity ?? 1),
    // Google Calendar busy time, re-read at confirm time (fresh context).
    busy: ctx.busy,
  }

  let staffId: string | null = null
  let staffName: string | null = null
  if (hasStaff) {
    const candidates = ctx.staff.filter(
      (s) => (!draft.staff_id || s.id === draft.staff_id) && (!service || s.service_ids.length === 0 || s.service_ids.includes(service.id)),
    )
    if (draft.staff_id && candidates.length === 0) return { ok: false, reason: 'invalid', detail: 'staff' }
    const free = candidates.find((s) => freeSlotsForStaff(s, date, q).includes(time))
    if (!free) {
      const alternatives = candidates.flatMap((s) => freeSlotsForStaff(s, date, q).map((t) => `${t}${candidates.length > 1 ? ` (${s.name})` : ''}`))
      return alternatives.length || candidates.length
        ? { ok: false, reason: 'slot_taken', alternatives: alternatives.slice(0, 6) }
        : { ok: false, reason: 'closed' }
    }
    staffId = free.id
    staffName = free.name
  } else if (!freeSlotsForBusiness(date, q).includes(time)) {
    const alternatives = freeSlotsForBusiness(date, q)
    return alternatives.length ? { ok: false, reason: 'slot_taken', alternatives: alternatives.slice(0, 6) } : { ok: false, reason: 'closed' }
  }

  let data: { id: string }
  try {
    data = await tenantDb(input.workspaceId).bookings.create({
      select: { id: true },
      data: {
      workspace_id: input.workspaceId,
      contact_id: input.contactId,
      conversation_id: input.conversationId,
      ai_agent_id: input.aiAgentId,
      service_id: service?.id ?? null,
      staff_id: staffId,
      product_id: draft.product_id ?? null,
      booking_date: date,
      booking_time: time,
      duration_minutes: duration,
      customer_name: draft.customer_name ?? null,
      party_size: draft.party_size ?? null,
      custom_fields: draft.fields ?? {},
      status: 'confirmed',
      source: input.source,
      },
    })
  } catch (error) {
    return { ok: false, reason: 'invalid', detail: error instanceof Error ? error.message : String(error) }
  }
  invalidateBusinessContext(input.workspaceId)
  if (staffId) scheduleBookingSync(data.id, input.workspaceId)
  return { ok: true, bookingId: data.id, staffName, serviceName: service?.name ?? null }
}

/** Cancels the contact's next upcoming booking (or a specific date/time). */
export async function cancelNextBooking(workspaceId: string, contactId: string, draft: BookingDraft): Promise<{ date: string; time: string } | null> {
  const ctx = await loadBusinessContext(workspaceId)
  const today = zonedNow(ctx?.timeZone ?? 'UTC').date
  const db = tenantDb(workspaceId)
  const data = await db.bookings.findFirst({
    select: { id: true, booking_date: true, booking_time: true },
    where: {
      workspace_id: workspaceId,
      contact_id: contactId,
      status: { in: ['pending', 'confirmed'] },
      booking_date: isIsoDate(draft.date) ? { gte: today, equals: draft.date } : { gte: today },
      ...(draft.time ? { booking_time: draft.time.padStart(5, '0') } : {}),
    },
    orderBy: [{ booking_date: 'asc' }, { booking_time: 'asc' }],
  })
  if (!data) return null
  await db.bookings.updateMany({ where: { id: data.id }, data: { status: 'cancelled' } })
  invalidateBusinessContext(workspaceId)
  scheduleBookingSync(data.id, workspaceId)
  void pushCancellations(workspaceId).catch(() => {})
  return { date: data.booking_date, time: data.booking_time }
}

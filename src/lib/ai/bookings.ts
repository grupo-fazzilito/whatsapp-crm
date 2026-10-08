import 'server-only'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getPreset, resolveIndustry } from '@/lib/industries'
import { freeSlotsForBusiness, freeSlotsForStaff } from './slots'
import { isIsoDate, zonedNow } from './time'
import { invalidateBusinessContext, loadBusinessContext } from './context'
import type { BookingDraft } from './types'
import { scheduleBookingSync } from '@/lib/integrations/google/sync'

export type BookingFailure =
  | { reason: 'missing'; missing: string[] }
  | { reason: 'slot_taken'; alternatives: string[] }
  | { reason: 'closed' }
  | { reason: 'past' }
  | { reason: 'invalid'; detail: string }

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

  const missing = missingBookingData(ctx.workspace.industry, draft, hasServices, hasStaff && getPreset(ctx.workspace.industry).bookingNeedsStaff)
  if (missing.length) return { ok: false, reason: 'missing', missing }

  const now = zonedNow(ctx.timeZone)
  const date = draft.date!
  const time = draft.time!.padStart(5, '0')
  if (date < now.date || (date === now.date && time <= now.time)) return { ok: false, reason: 'past' }

  const service = hasServices ? ctx.services.find((s) => s.id === draft.service_id) : undefined
  if (hasServices && !service) return { ok: false, reason: 'invalid', detail: 'service' }
  const duration = service?.duration_minutes ?? 30
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

  const { data, error } = await supabaseAdmin()
    .from('bookings')
    .insert({
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
    })
    .select('id')
    .single()
  if (error) return { ok: false, reason: 'invalid', detail: error.message }
  invalidateBusinessContext(input.workspaceId)
  if (staffId) scheduleBookingSync(data.id, input.workspaceId)
  return { ok: true, bookingId: data.id, staffName, serviceName: service?.name ?? null }
}

/** Cancels the contact's next upcoming booking (or a specific date/time). */
export async function cancelNextBooking(workspaceId: string, contactId: string, draft: BookingDraft): Promise<{ date: string; time: string } | null> {
  const ctx = await loadBusinessContext(workspaceId)
  const today = zonedNow(ctx?.timeZone ?? 'UTC').date
  let query = supabaseAdmin()
    .from('bookings')
    .select('id, booking_date, booking_time')
    .eq('workspace_id', workspaceId)
    .eq('contact_id', contactId)
    .in('status', ['pending', 'confirmed'])
    .gte('booking_date', today)
    .order('booking_date')
    .order('booking_time')
    .limit(1)
  if (isIsoDate(draft.date)) query = query.eq('booking_date', draft.date)
  if (draft.time) query = query.eq('booking_time', draft.time.padStart(5, '0'))
  const { data } = await query.maybeSingle()
  if (!data) return null
  await supabaseAdmin().from('bookings').update({ status: 'cancelled' }).eq('id', data.id)
  invalidateBusinessContext(workspaceId)
  scheduleBookingSync(data.id, workspaceId)
  return { date: data.booking_date, time: data.booking_time }
}

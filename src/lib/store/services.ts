import 'server-only'
import crypto from 'node:crypto'
import { tenantDb } from '@/lib/db/tenant'
import { getPreset, resolveIndustry } from '@/lib/industries'
import { BOOKING_HORIZON_DAYS, loadBusinessContext, type BusinessContext } from '@/lib/ai/context'
import { freeSlotsForBusiness, freeSlotsForStaff, upcomingDates, type SlotQuery } from '@/lib/ai/slots'
import { isIsoDate, zonedNow } from '@/lib/ai/time'
import { createBookingFromDraft } from '@/lib/ai/bookings'
import { contactFor, loadCheckoutOptions, notifyTeam, type PublicStore, type StoreWorkspace } from './server'
import type { ServiceCheckoutInput } from './service-checkout'

// Services of the online store: listed from the Services module, bought one
// at a time. "schedule" services take a day and time at checkout and create
// the booking with the order; "later" ones are agreed in the chat.

export interface StoreServiceField {
  key: string
  type: 'text' | 'number'
  label: string
  required: boolean
}

export interface StoreService {
  id: string
  name: string
  description: string | null
  category: string | null
  price: number
  price_is_from: boolean
  duration_minutes: number
  image_url: string | null
  booking: 'schedule' | 'later'
  /** People who do it (empty = no choice to make). */
  staff: { id: string; name: string }[]
}

/** Booking data the industry asks for (age, party size…), besides the name. */
export function storeBookingFields(ws: Pick<StoreWorkspace, 'industry' | 'locale'>): StoreServiceField[] {
  return getPreset(ws.industry)
    .bookingFields.filter((f) => f.key !== 'customer_name' && f.type !== 'product')
    .map((f) => ({ key: f.key, type: f.type === 'number' ? 'number' : 'text', label: f.label[ws.locale] ?? f.label.es, required: f.required }))
}

function servicesOn(ws: Pick<StoreWorkspace, 'industry' | 'settings'>): { services: boolean; staff: boolean } {
  const m = resolveIndustry(ws.industry, ws.settings).modules
  return { services: !!m.services, staff: !!m.staff }
}

function staffFor(ctx: BusinessContext, serviceId: string, staffModule: boolean) {
  if (!staffModule) return []
  return ctx.staff.filter((s) => s.service_ids.length === 0 || s.service_ids.includes(serviceId))
}

/** Active services shown in the store. Calendly-booked ones are arranged later. */
export async function loadStoreServices(ws: StoreWorkspace, serviceId?: string): Promise<StoreService[]> {
  const on = servicesOn(ws)
  if (!on.services) return []
  const rows = await tenantDb(ws.id).services.findMany({
    where: { is_active: true, show_in_store: true, ...(serviceId ? { id: serviceId } : {}) },
    orderBy: [{ category: { sort: 'asc', nulls: 'last' } }, { name: 'asc' }],
    take: 200,
  })
  if (!rows.length) return []
  const ctx = await loadBusinessContext(ws.id)
  return rows.map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    category: s.category,
    price: Number(s.price ?? 0),
    price_is_from: s.price_is_from,
    duration_minutes: s.duration_minutes ?? 30,
    image_url: s.image_url && /^https?:\/\//.test(s.image_url) ? s.image_url : null,
    booking: s.store_booking === 'later' || ctx?.calendly?.[s.id] ? 'later' : 'schedule',
    staff: ctx ? staffFor(ctx, s.id, on.staff).map((x) => ({ id: x.id, name: x.name })) : [],
  }))
}

function slotQuery(ctx: BusinessContext, duration: number): SlotQuery {
  const now = zonedNow(ctx.timeZone)
  return {
    hours: ctx.hours,
    exceptions: ctx.exceptions,
    bookings: ctx.bookings,
    today: now.date,
    nowTime: now.time,
    durationMinutes: duration,
    stepMinutes: 15,
    capacity: Number(ctx.workspace.settings?.booking_capacity ?? 1),
    busy: ctx.busy,
  }
}

/**
 * Free times of a service: the days of the booking horizon that have any,
 * and the times of `date` (with one staff member, or any of them).
 */
export async function serviceSlots(
  ws: StoreWorkspace,
  service: StoreService,
  staffId: string | null,
  date: string | null,
): Promise<{ days: { date: string; open: boolean }[]; times: string[] }> {
  const ctx = await loadBusinessContext(ws.id, true)
  if (!ctx) return { days: [], times: [] }
  const q = slotQuery(ctx, service.duration_minutes)
  // Same rule as createBookingFromDraft: with staff, someone who does this service must be free.
  const hasStaff = servicesOn(ws).staff && ctx.staff.length > 0
  const people = staffFor(ctx, service.id, hasStaff).filter((s) => !staffId || s.id === staffId)
  const timesOn = (d: string) => (hasStaff ? [...new Set(people.flatMap((s) => freeSlotsForStaff(s, d, q)))].sort() : freeSlotsForBusiness(d, q))
  const days = upcomingDates(q.today, BOOKING_HORIZON_DAYS).map((d) => ({ date: d, open: timesOn(d).length > 0 }))
  return { days, times: date && isIsoDate(date) ? timesOn(date) : [] }
}

export type PlaceServiceResult =
  | { ok: true; number: number; token: string; total: number }
  | { ok: false; error: 'unavailable' | 'slot_taken' | 'closed' | 'past' | 'payment' | 'fields' | 'failed'; alternatives?: string[]; missing?: string[] }

const round2 = (n: number) => Math.round(n * 100) / 100

export async function placeServiceOrder(store: PublicStore, input: ServiceCheckoutInput): Promise<PlaceServiceResult> {
  const ws = store.workspace
  const db = tenantDb(ws.id)
  const service = (await loadStoreServices(ws, input.service_id))[0]
  if (!service) return { ok: false, error: 'unavailable' }

  const total = round2(service.price)
  let payment: { id: string; name: string; requires_proof: boolean } | null = null
  if (total > 0) {
    const { payments } = await loadCheckoutOptions(ws.id)
    payment = payments.find((p) => p.id === input.payment_method_id) ?? null
    if (!payment) return { ok: false, error: 'payment' }
  }

  // The industry's booking data (age, party size…).
  const fields = storeBookingFields(ws)
  const missing = fields.filter((f) => f.required && (input.fields[f.key] === undefined || input.fields[f.key] === ''))
  if (service.booking === 'schedule' && missing.length) return { ok: false, error: 'fields', missing: missing.map((f) => f.key) }

  const contactId = await contactFor(ws.id, input.customer.name, input.customer.phone, input.customer.email)

  let bookingId: string | null = null
  let when: string | null = null
  if (service.booking === 'schedule') {
    if (!isIsoDate(input.date) || !input.time) return { ok: false, error: 'slot_taken' }
    const partySize = Number(input.fields.party_size)
    const extra = Object.fromEntries(Object.entries(input.fields).filter(([k]) => k !== 'party_size'))
    const r = await createBookingFromDraft({
      workspaceId: ws.id,
      contactId,
      conversationId: null,
      aiAgentId: null,
      draft: {
        service_id: service.id,
        staff_id: input.staff_id,
        date: input.date,
        time: input.time,
        customer_name: input.customer.name,
        party_size: Number.isInteger(partySize) && partySize > 0 ? partySize : null,
        fields: extra,
      },
      source: 'store',
    })
    if (!r.ok) {
      if (r.reason === 'slot_taken') return { ok: false, error: 'slot_taken', alternatives: r.alternatives }
      if (r.reason === 'closed' || r.reason === 'past') return { ok: false, error: r.reason }
      if (r.reason === 'missing') return { ok: false, error: 'fields', missing: r.missing }
      return { ok: false, error: 'failed' }
    }
    bookingId = r.bookingId
    const [y, m, d] = input.date.split('-')
    when = `${d}/${m}/${y} ${input.time}${r.staffName ? ` · ${r.staffName}` : ''}`
  }

  const token = crypto.randomBytes(18).toString('base64url')
  const order = await db.orders.create({
    data: {
      workspace_id: ws.id,
      contact_id: contactId,
      fulfillment: 'service',
      customer_name: input.customer.name,
      customer_phone: input.customer.phone,
      customer_email: input.customer.email,
      customer_document: input.customer.document,
      notes: input.notes,
      currency: ws.currency,
      subtotal: total,
      delivery_fee: 0,
      total,
      payment_method_id: payment?.id ?? null,
      payment_method_name: payment?.name ?? null,
      payment_status: total > 0 && payment?.requires_proof ? 'awaiting_proof' : total > 0 ? 'unpaid' : 'paid',
      source: 'store',
      public_token: token,
      booking_id: bookingId,
      created_by: null,
    },
    select: { id: true, number: true },
  })
  await db.order_items.create({
    data: {
      workspace_id: ws.id,
      order_id: order.id,
      service_id: service.id,
      name: when ? `${service.name} (${when})` : service.name,
      quantity: 1,
      unit_price: total,
      total,
      sort_order: 0,
    },
  })
  await db.order_events.create({ data: { workspace_id: ws.id, order_id: order.id, type: 'created', to_value: 'pending', note: 'store' } })
  const number = Number(order.number)
  await notifyTeam(ws, order.id, number, input.customer.name, total).catch((err) => console.error('[store] notify failed:', err instanceof Error ? err.message : err))
  return { ok: true, number, token, total }
}

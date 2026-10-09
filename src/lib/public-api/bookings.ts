import 'server-only'
import { tenantDb } from '@/lib/db/tenant'
import { createBookingFromDraft } from '@/lib/ai/bookings'
import { invalidateBusinessContext } from '@/lib/ai/context'
import { scheduleBookingSync } from '@/lib/integrations/google/sync'
import { ApiError, badRequest, notFound, unprocessable } from './errors'
import { keysetPage, selectOf } from './keyset'
import { parseIsoParam } from './pagination'
import { BOOKING_SELECT, serializeBooking } from './serializers'
import { bool, isIsoDateOnly, isUuidLike, num, obj, oneOf, queryEnum, queryUuid, str, uuid } from './validate'

export const BOOKING_STATUSES = ['pending', 'confirmed', 'completed', 'cancelled', 'no_show'] as const

const BOOKING_FIELDS = selectOf(BOOKING_SELECT)
type BookingRow = Record<string, unknown> & { id: string }

export async function listBookings(workspaceId: string, url: URL) {
  const sp = url.searchParams
  const where: Record<string, unknown> = { workspace_id: workspaceId }
  const status = queryEnum(url, 'status', BOOKING_STATUSES)
  if (status) where.status = status
  const bookingDate: Record<string, string> = {}
  for (const [param, op] of [['date_from', 'gte'], ['date_to', 'lte']] as const) {
    const v = sp.get(param)
    if (!v) continue
    if (!isIsoDateOnly(v)) throw badRequest(`${param} must be YYYY-MM-DD.`, { field: param })
    bookingDate[op] = v
  }
  if (Object.keys(bookingDate).length) where.booking_date = bookingDate
  for (const key of ['staff_id', 'contact_id', 'service_id'] as const) {
    const v = queryUuid(url, key)
    if (v) where[key] = v
  }
  const since = parseIsoParam(sp.get('updated_since'))
  if (since) where.updated_at = { gte: since }
  const db = tenantDb(workspaceId)
  const page = await keysetPage({
    workspaceId,
    table: 'bookings',
    column: 'created_at',
    where,
    url,
    findMany: (args) => db.bookings.findMany({ ...args, select: BOOKING_FIELDS }) as unknown as Promise<BookingRow[]>,
  })
  return { data: page.data.map(serializeBooking), next_cursor: page.next_cursor }
}

export async function getBooking(workspaceId: string, id: string) {
  if (!isUuidLike(id)) throw notFound('Booking')
  const data = await tenantDb(workspaceId)
    .bookings.findFirst({ select: BOOKING_FIELDS, where: { id, workspace_id: workspaceId } })
    .catch(() => null)
  if (!data) throw notFound('Booking')
  return serializeBooking(data as unknown as BookingRow)
}

type RefTable = 'contacts' | 'conversations' | 'services' | 'staff' | 'products'

async function assertInWorkspace(table: RefTable, id: string | null | undefined, workspaceId: string, field: string) {
  if (!id) return
  const db = tenantDb(workspaceId)
  const args = { select: { id: true }, where: { id, workspace_id: workspaceId } } as const
  const lookups: Record<RefTable, () => Promise<{ id: string } | null>> = {
    contacts: () => db.contacts.findFirst(args),
    conversations: () => db.conversations.findFirst(args),
    services: () => db.services.findFirst(args),
    staff: () => db.staff.findFirst(args),
    products: () => db.products.findFirst(args),
  }
  const data = await lookups[table]().catch(() => null)
  if (!data) throw unprocessable('invalid_reference', `${field} doesn't belong to this workspace.`, { field })
}

function fieldsOf(raw: Record<string, unknown> | undefined): Record<string, string | number | null> {
  const out: Record<string, string | number | null> = {}
  for (const [k, v] of Object.entries(raw ?? {}).slice(0, 30)) {
    if (!/^[a-z0-9_]{1,40}$/i.test(k)) continue
    if (v === null || typeof v === 'number') out[k] = v
    else if (typeof v === 'string') out[k] = v.slice(0, 500)
  }
  return out
}

/**
 * POST /bookings. With check_availability (default true) the booking goes
 * through the same engine as the AI agent (business hours, staff agenda,
 * Google Calendar busy time); 422 slot_taken returns alternatives.
 * check_availability=false books the slot as given (manual entry).
 */
export async function createBooking(workspaceId: string, body: Record<string, unknown>) {
  const contactId = uuid(body, 'contact_id', { required: true })!
  const date = str(body, 'date', { required: true })!
  const time = str(body, 'time', { required: true })!
  if (!isIsoDateOnly(date)) throw badRequest('date must be YYYY-MM-DD.', { field: 'date' })
  if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(time)) throw badRequest('time must be HH:MM (24 h, workspace time zone).', { field: 'time' })
  const serviceId = uuid(body, 'service_id') ?? null
  const staffId = uuid(body, 'staff_id') ?? null
  const productId = uuid(body, 'product_id') ?? null
  const conversationId = uuid(body, 'conversation_id') ?? null
  const customerName = str(body, 'customer_name', { max: 200 }) ?? null
  const partySize = num(body, 'party_size', { min: 1, max: 1000, integer: true }) ?? null
  const notes = str(body, 'notes', { max: 2000 }) ?? null
  const fields = fieldsOf(obj(body, 'fields'))
  const check = bool(body, 'check_availability') ?? true

  await assertInWorkspace('contacts', contactId, workspaceId, 'contact_id')
  await assertInWorkspace('conversations', conversationId, workspaceId, 'conversation_id')
  await assertInWorkspace('services', serviceId, workspaceId, 'service_id')
  await assertInWorkspace('staff', staffId, workspaceId, 'staff_id')
  await assertInWorkspace('products', productId, workspaceId, 'product_id')

  let bookingId: string
  if (check) {
    const res = await createBookingFromDraft({
      workspaceId,
      contactId,
      conversationId,
      aiAgentId: null,
      source: 'manual',
      draft: { service_id: serviceId, staff_id: staffId, product_id: productId, date, time, customer_name: customerName, party_size: partySize, fields },
    })
    if (!res.ok) {
      const details: Record<string, unknown> = { reason: res.reason }
      if (res.reason === 'missing') details.missing = res.missing
      if (res.reason === 'slot_taken') details.alternatives = res.alternatives
      if (res.reason === 'invalid') details.detail = res.detail
      const messages: Record<string, string> = {
        missing: 'Some booking data is missing.',
        slot_taken: 'That time is not available.',
        closed: 'The business is closed on that date.',
        past: 'The date/time is in the past.',
        invalid: 'The booking data is invalid.',
      }
      throw new ApiError(422, res.reason === 'slot_taken' ? 'slot_unavailable' : `booking_${res.reason}`, messages[res.reason], details)
    }
    bookingId = res.bookingId
    if (notes) {
      await tenantDb(workspaceId)
        .bookings.updateMany({ where: { id: bookingId, workspace_id: workspaceId }, data: { notes } })
        .catch(() => null)
    }
  } else {
    let duration = num(body, 'duration_minutes', { min: 5, max: 1440, integer: true }) ?? null
    if (!duration && serviceId) {
      const svc = await tenantDb(workspaceId)
        .services.findFirst({ select: { duration_minutes: true }, where: { id: serviceId } })
        .catch(() => null)
      duration = svc?.duration_minutes ?? null
    }
    const data = await tenantDb(workspaceId).bookings.create({
      data: {
        workspace_id: workspaceId,
        contact_id: contactId,
        conversation_id: conversationId,
        service_id: serviceId,
        staff_id: staffId,
        product_id: productId,
        booking_date: date,
        booking_time: time.padStart(5, '0'),
        duration_minutes: duration ?? 30,
        customer_name: customerName,
        party_size: partySize,
        notes,
        custom_fields: fields,
        status: oneOf(body, 'status', ['pending', 'confirmed'] as const) ?? 'confirmed',
        source: 'manual',
      },
      select: { id: true },
    })
    bookingId = data.id
    invalidateBusinessContext(workspaceId)
    if (staffId) scheduleBookingSync(bookingId, workspaceId)
  }
  return getBooking(workspaceId, bookingId)
}

/** PATCH /bookings/{id}: { status?, notes? } */
export async function patchBooking(workspaceId: string, id: string, body: Record<string, unknown>) {
  const current = await getBooking(workspaceId, id)
  const patch: Record<string, unknown> = {}
  const status = oneOf(body, 'status', BOOKING_STATUSES)
  if (status) patch.status = status
  const notes = str(body, 'notes', { max: 2000 })
  if (notes !== undefined) patch.notes = notes
  if (!Object.keys(patch).length) throw badRequest('Send status and/or notes.')
  await tenantDb(workspaceId).bookings.updateMany({ where: { id, workspace_id: workspaceId }, data: patch })
  if (status && status !== current.status) {
    invalidateBusinessContext(workspaceId)
    if (current.staff_id) scheduleBookingSync(id, workspaceId)
  }
  return getBooking(workspaceId, id)
}

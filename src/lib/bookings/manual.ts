import 'server-only'
import type { TenantDb } from '@/lib/db/tenant'
import { assertOwned } from '@/lib/business/setup-server'

/** Booking row in the dashboard shape (relations renamed like the old PostgREST select). */
export const BOOKING_INCLUDE = {
  contacts: { select: { id: true, name: true, phone: true } },
  staff: { select: { id: true, name: true, title: true } },
  services: { select: { id: true, name: true } },
} as const

type WithRelations = { contacts: unknown; staff: unknown; services: unknown } & Record<string, unknown>

export function bookingOut<T extends WithRelations>({ contacts, staff, services, ...row }: T) {
  return { ...row, contact: contacts, staff, service: services }
}

/** Every referenced row must belong to the workspace of `db`. */
export async function assertBookingRefs(db: TenantDb, data: Record<string, unknown>) {
  await Promise.all([
    assertOwned(db, 'contacts', [data.contact_id as string | null]),
    assertOwned(db, 'staff', [data.staff_id as string | null]),
    assertOwned(db, 'services', [data.service_id as string | null]),
    assertOwned(db, 'products', [data.product_id as string | null]),
  ])
}

export type ManualCalendlyResult =
  | { kind: 'not_linked' }
  | { kind: 'booked'; bookingId: string }
  /** The business's Calendly plan can't book by API: saved in Whasalia only. */
  | { kind: 'plan_limited' }
  | { kind: 'error'; code: 'email' | 'slot' }

/**
 * A booking made by hand for a service linked to Calendly is booked in
 * Calendly first (its email invitation, its availability), then stored
 * like the AI's. Services without a Calendly event type are untouched.
 */
export async function bookManualInCalendly(workspaceId: string, timeZone: string, data: Record<string, unknown>): Promise<ManualCalendlyResult> {
  const serviceId = typeof data.service_id === 'string' ? data.service_id : null
  if (!serviceId || data.status === 'cancelled') return { kind: 'not_linked' }
  const { loadCalendlyLinks, bookWithCalendly } = await import('@/lib/integrations/calendly/booking')
  const link = (await loadCalendlyLinks(workspaceId).catch(() => ({}) as Awaited<ReturnType<typeof loadCalendlyLinks>>))[serviceId]
  if (!link) return { kind: 'not_linked' }
  if (link.canBook === false) return { kind: 'plan_limited' }
  const r = await bookWithCalendly({
    workspaceId,
    contactId: data.contact_id as string,
    conversationId: null,
    aiAgentId: null,
    serviceId,
    link,
    date: data.booking_date as string,
    time: String(data.booking_time).slice(0, 5),
    customerName: (data.customer_name as string | null) ?? null,
    email: null,
    timeZone,
    durationMinutes: Number(data.duration_minutes) || 30,
    partySize: (data.party_size as number | null) ?? null,
    fields: (data.custom_fields as Record<string, unknown>) ?? {},
    source: 'manual',
  })
  if (r.ok) return { kind: 'booked', bookingId: r.bookingId }
  if (r.reason === 'link') return { kind: 'plan_limited' }
  if (r.reason === 'missing') return { kind: 'error', code: 'email' }
  return { kind: 'error', code: 'slot' }
}

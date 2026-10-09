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

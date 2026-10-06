import type { BookingField } from '@/lib/industries'

export const BOOKING_STATUSES = ['pending', 'confirmed', 'completed', 'cancelled', 'no_show'] as const
export type BookingStatus = (typeof BOOKING_STATUSES)[number]
export const ACTIVE_STATUSES: BookingStatus[] = ['pending', 'confirmed']

export interface Booking {
  id: string
  workspace_id: string
  contact_id: string | null
  staff_id: string | null
  service_id: string | null
  product_id: string | null
  booking_date: string
  booking_time: string
  duration_minutes: number | null
  customer_name: string | null
  party_size: number | null
  notes: string | null
  custom_fields: Record<string, unknown> | null
  status: BookingStatus
  source: 'ai' | 'manual' | string
  conversation_id: string | null
  feedback_sent: boolean | null
  followup_sent: boolean | null
  reminder_24h_sent: boolean | null
  reminder_4h_sent: boolean | null
  reminder_2h_sent: boolean | null
  created_at: string
  updated_at: string
  contact: { id: string; name: string | null; phone: string | null } | null
  staff: { id: string; name: string; title: string | null } | null
  service: { id: string; name: string } | null
}

export const BOOKING_SELECT = `
  *,
  contact:contacts(id, name, phone),
  staff:staff(id, name, title),
  service:services(id, name)
`

export interface ContactLite {
  id: string
  name: string | null
  phone: string | null
}

export interface ServiceLite {
  id: string
  name: string
  duration_minutes: number | null
  price: number | null
  is_active: boolean
}

export interface ProductLite {
  id: string
  name: string
}

/** Keys of the preset's bookingFields that live in their own column. */
export const COLUMN_FIELDS = ['customer_name', 'party_size', 'product_id'] as const

export function isColumnField(f: BookingField) {
  return (COLUMN_FIELDS as readonly string[]).includes(f.key)
}

export function customerName(b: Pick<Booking, 'customer_name' | 'contact'>): string {
  return b.customer_name?.trim() || b.contact?.name?.trim() || b.contact?.phone || ''
}

export const STATUS_STYLE: Record<BookingStatus, string> = {
  pending: 'bg-amber-500/10 text-amber-700 border-amber-500/30 dark:text-amber-300',
  confirmed: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/30 dark:text-emerald-300',
  completed: 'bg-sky-500/10 text-sky-700 border-sky-500/30 dark:text-sky-300',
  cancelled: 'bg-rose-500/10 text-rose-700 border-rose-500/30 dark:text-rose-300',
  no_show: 'bg-slate-500/10 text-slate-700 border-slate-500/30 dark:text-slate-300',
}

export type MessageAction = 'confirm' | 'reminder' | 'feedback' | 'followup'

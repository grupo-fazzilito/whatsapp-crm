// Customer-facing booking messages (confirmation, reminders, status
// changes, feedback, follow-up) in the workspace's language, using the
// industry's own nouns ("cita", "turno", "reservación", "clase"...).

import { createTranslator } from '@/i18n/translate'
import { industryLabel } from '@/lib/industries'
import type { WorkspaceSettings } from '@/lib/workspace/types'

export type BookingMessageKind =
  | 'confirmation'
  | 'reminder'
  | 'reminder_24h'
  | 'reminder_4h'
  | 'reminder_2h'
  | 'cancelled'
  | 'completed'
  | 'feedback'
  | 'followup'

export interface BookingMessageInput {
  locale: 'es' | 'en'
  industry: string
  settings?: WorkspaceSettings | null
  businessName: string
  customerName?: string | null
  staffName?: string | null
  serviceName?: string | null
  /** Local 'YYYY-MM-DD' of the business. */
  date: string
  /** Local 'HH:MM' of the business. */
  time: string
  partySize?: number | null
}

const INTL_LOCALE = { es: 'es-MX', en: 'en-US' } as const

/** "martes 6 de octubre" / "Tuesday, October 6" for a local date string. */
export function formatBookingDate(date: string, locale: 'es' | 'en'): string {
  const [y, m, d] = date.split('-').map(Number)
  if (!y || !m || !d) return date
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)))
}

/** "16:30" / "4:30 PM" for a local 'HH:MM'. */
export function formatBookingTime(time: string, locale: 'es' | 'en'): string {
  const [h, mi] = (time || '').split(':').map(Number)
  if (Number.isNaN(h)) return time
  if (locale === 'es') return `${String(h).padStart(2, '0')}:${String(mi || 0).padStart(2, '0')}`
  return new Intl.DateTimeFormat(INTL_LOCALE.en, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(
    new Date(Date.UTC(2000, 0, 1, h, mi || 0)),
  )
}

export function buildBookingMessage(kind: BookingMessageKind, input: BookingMessageInput): string {
  const { locale } = input
  const t = createTranslator(locale)
  const lower = (s: string) => s.toLocaleLowerCase(locale)
  const booking = lower(industryLabel(input.industry, 'booking', locale, input.settings))
  const vars = {
    booking,
    business: input.businessName,
    // Leading space so templates read "Hola{name}" → "Hola Ana" / "Hola".
    name: input.customerName?.trim() ? ` ${input.customerName.trim()}` : '',
    date: formatBookingDate(input.date, locale),
    time: formatBookingTime(input.time, locale),
    withStaff: input.staffName ? t('bookings.messages.withStaff', { staff: input.staffName }) : '',
    service: input.serviceName ? t('bookings.messages.serviceSuffix', { service: input.serviceName }) : '',
    party: input.partySize ? t('bookings.messages.partySuffix', { count: input.partySize }) : '',
  }
  return t(`bookings.messages.${kind}`, vars)
}

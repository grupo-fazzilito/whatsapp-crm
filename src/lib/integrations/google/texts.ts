// Customer messages sent when an advisor moves or deletes the booking's
// event in their Google Calendar. Workspace language, industry noun.

import { formatBookingDate, formatBookingTime } from '@/lib/bookings/messages'

export interface InboundTextInput {
  locale: 'es' | 'en'
  /** Industry noun in lower case, e.g. "visita", "cita". */
  booking: string
  customerName?: string | null
  date: string
  time: string
}

function hello(locale: 'es' | 'en', name?: string | null) {
  const first = name?.trim().split(/\s+/)[0]
  if (locale === 'en') return first ? `Hi ${first}, ` : 'Hi, '
  return first ? `Hola ${first}, ` : 'Hola, '
}

export function rescheduledText(i: InboundTextInput): string {
  const date = formatBookingDate(i.date, i.locale)
  const time = formatBookingTime(i.time, i.locale)
  if (i.locale === 'en') {
    return `${hello('en', i.customerName)}your ${i.booking} has been rescheduled to ${date} at ${time}. If that time doesn't work for you, just reply and we'll find another one.`
  }
  return `${hello('es', i.customerName)}tu ${i.booking} se reprogramó para el ${date} a las ${time}. Si no te acomoda, respóndenos y buscamos otro horario.`
}

export function cancelledText(i: InboundTextInput): string {
  const date = formatBookingDate(i.date, i.locale)
  const time = formatBookingTime(i.time, i.locale)
  if (i.locale === 'en') {
    return `${hello('en', i.customerName)}your ${i.booking} on ${date} at ${time} has been cancelled. Reply to this message if you'd like to book a new time.`
  }
  return `${hello('es', i.customerName)}se canceló tu ${i.booking} del ${date} a las ${time}. Si quieres agendar un nuevo horario, respóndenos por aquí.`
}

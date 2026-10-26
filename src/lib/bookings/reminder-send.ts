import 'server-only'
import { tenantDb } from '@/lib/db/tenant'
import { sendMessage } from '@/lib/messaging/send'
import { conversationForContact } from '@/lib/messaging/conversations'
import { windowState } from '@/lib/automations/followup-rules'
import { canSpend, spend } from '@/lib/billing/credits'
import { industryLabel } from '@/lib/industries'
import { createTranslator } from '@/i18n/translate'
import type { ChannelType } from '@/lib/channels'
import { formatBookingDate, formatBookingTime } from './messages'
import type { ReminderKind } from './reminders'
import { fillReminderText, parseReminderReply, reminderReplyId, reminderSettings, type ReminderPlaceholder } from './reminder-settings'
import { REMINDER_TEMPLATE_NAME, reminderButtons, reminderTemplate, reminderTemplateComponents } from './reminder-template'
import type { BookingBundle } from './server'

// One booking reminder: text with "Confirm / Change date" buttons
// while the customer's reply window is open, the business's approved WhatsApp
// template otherwise. Each reminder sent costs one credit ('reminder'). It is
// tried once: when it can't go out, the reason is kept on the booking
// (bookings.reminder_error) instead of retrying every few minutes.

type Lang = 'es' | 'en'
type Ws = NonNullable<BookingBundle['workspace']>

/** Why a reminder wasn't sent (bookings.reminder_error, shown on the booking). */
export type ReminderSkip =
  | 'off'
  | 'no_contact'
  | 'no_credits'
  | 'no_channel'
  | 'window_closed'
  | 'template_missing'
  | 'template_pending'
  | 'template_rejected'
  | 'send_failed'

export type ReminderResult = { ok: true; conversationId: string } | { ok: false; reason: ReminderSkip }

export function reminderValues(b: BookingBundle, ws: Ws): Record<ReminderPlaceholder, string> {
  const lang: Lang = ws.locale === 'en' ? 'en' : 'es'
  return {
    nombre: (b.customer_name || b.contact?.name || '').trim(),
    cita: industryLabel(ws.industry, 'booking', lang, ws.settings).toLocaleLowerCase(lang),
    servicio: b.service?.name ?? '',
    profesional: b.staff?.name ?? '',
    fecha: formatBookingDate(b.booking_date, lang),
    hora: formatBookingTime(b.booking_time, lang),
    negocio: ws.name,
  }
}

/** `kind: 'manual'` = the "Reminder" button on a booking (no on/off setting, default text). */
export async function sendBookingReminder(b: BookingBundle, ws: Ws, kind: ReminderKind | 'manual', defaultText: string): Promise<ReminderResult> {
  const settings = reminderSettings(ws.settings)
  if (kind !== 'manual' && settings.off.includes(kind)) return { ok: false, reason: 'off' }
  if (!b.contact_id) return { ok: false, reason: 'no_contact' }
  if (!(await canSpend(ws.id, 'reminder'))) return { ok: false, reason: 'no_credits' }

  const conversationId = await conversationForContact(ws.id, b.contact_id)
  if (!conversationId) return { ok: false, reason: 'no_channel' }
  const conv = await tenantDb(ws.id)
    .conversations.findFirst({ where: { id: conversationId }, select: { last_customer_message_at: true, channels: { select: { type: true } } } })
    .catch(() => null)
  const channelType = (conv?.channels?.type ?? 'whatsapp') as ChannelType
  const lang: Lang = ws.locale === 'en' ? 'en' : 'es'
  const values = reminderValues(b, ws)
  const metadata = { source: 'booking', kind: kind === 'manual' ? 'reminder' : `reminder_${kind}`, booking_id: b.id }

  let sent: Awaited<ReturnType<typeof sendMessage>>
  if (windowState(channelType, (conv?.last_customer_message_at as string | null) ?? null).open) {
    const custom = kind === 'manual' ? undefined : settings.texts[kind]
    const buttons = reminderButtons(lang)
    sent = await sendMessage({
      workspaceId: ws.id,
      conversationId,
      content: {
        type: 'buttons',
        text: custom ? fillReminderText(custom, values) : defaultText,
        options: [
          { id: reminderReplyId('confirm', b.id), title: buttons.confirm },
          { id: reminderReplyId('change', b.id), title: buttons.change },
        ],
      },
      sender: { type: 'bot' },
      metadata,
    })
  } else {
    if (channelType !== 'whatsapp') return { ok: false, reason: 'window_closed' }
    const tpl = await reminderTemplate(ws.id, lang)
    if (!tpl) return { ok: false, reason: 'template_missing' }
    if (tpl.status === 'Rejected') return { ok: false, reason: 'template_rejected' }
    if (tpl.status !== 'Approved') return { ok: false, reason: 'template_pending' }
    const { components, text } = reminderTemplateComponents(values, b.id, lang)
    sent = await sendMessage({
      workspaceId: ws.id,
      conversationId,
      content: { type: 'template', templateName: REMINDER_TEMPLATE_NAME, language: tpl.language, category: 'UTILITY', components },
      sender: { type: 'bot' },
      metadata: { ...metadata, template: REMINDER_TEMPLATE_NAME },
    })
    // The inbox shows what the customer read, not "[Template: …]".
    if (sent.messageId) await tenantDb(ws.id).messages.updateMany({ where: { id: sent.messageId }, data: { content_text: text } }).catch(() => undefined)
  }
  if (sent.status === 'failed') {
    console.error(`[reminders] ${kind} for ${b.id} failed:`, sent.error)
    return { ok: false, reason: 'send_failed' }
  }
  await spend(ws.id, 'reminder', { conversationId })
  return { ok: true, conversationId }
}

/**
 * A tapped reminder button. "Confirm" confirms the booking; "I need to change
 * it" sends the booking picker for the same service and staff member — the
 * new booking replaces the old one. Returns true when handled.
 */
export async function handleReminderReply(input: { workspaceId: string; conversationId: string; contactId: string; replyId: string | null }): Promise<boolean> {
  const parsed = parseReminderReply(input.replyId)
  if (!parsed) return false
  const db = tenantDb(input.workspaceId)
  const booking = await db.bookings
    .findFirst({ where: { id: parsed.bookingId }, select: { id: true, contact_id: true, status: true, service_id: true, staff_id: true } })
    .catch(() => null)
  const ws = await db.workspaces.findFirst({ where: { id: input.workspaceId }, select: { locale: true } }).catch(() => null)
  const t = createTranslator(ws?.locale === 'en' ? 'en' : 'es')
  const say = (text: string) =>
    sendMessage({ workspaceId: input.workspaceId, conversationId: input.conversationId, content: { type: 'text', text }, sender: { type: 'bot' }, metadata: { source: 'booking', booking_id: parsed.bookingId } })

  if (!booking || booking.contact_id !== input.contactId || !['pending', 'confirmed'].includes(booking.status ?? '')) {
    await say(t('bookings.reminders.reply.gone'))
    return true
  }
  if (parsed.action === 'confirm') {
    if (booking.status !== 'confirmed') await db.bookings.updateMany({ where: { id: booking.id }, data: { status: 'confirmed', updated_at: new Date() } })
    await say(t('bookings.reminders.reply.confirmed'))
    return true
  }
  const { startBookingPicker } = await import('./picker')
  const r = await startBookingPicker({
    workspaceId: input.workspaceId,
    conversationId: input.conversationId,
    origin: 'inbox',
    preset: { service_id: booking.service_id, staff_id: booking.staff_id, replaces: booking.id },
  })
  if (r.status === 'error') await say(t('bookings.reminders.reply.changeHuman'))
  return true
}

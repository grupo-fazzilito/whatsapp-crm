import 'server-only'
import { prisma } from '@/lib/db/prisma'
import { tenantDb } from '@/lib/db/tenant'
import { saveTemplate } from '@/lib/templates/server'
import type { TemplateDraft } from '@/lib/templates/model'
import { reminderReplyId, type ReminderPlaceholder } from './reminder-settings'

// The WhatsApp template each business gets for reminders outside the 24 h
// window (Utility category, two quick replies). Whasalia creates it and sends
// it to Meta on its own; it shows in Settings → Templates like any other.

export const REMINDER_TEMPLATE_NAME = 'recordatorio_cita_whasalia'
/** A draft that failed to submit is retried at most this often. */
const RETRY_MS = 24 * 3600_000

type Lang = 'es' | 'en'

const BUTTONS: Record<Lang, [string, string]> = {
  es: ['Confirmo', 'Cambiar fecha'],
  en: ['I confirm', 'Change date'],
}

export function reminderButtons(lang: Lang): { confirm: string; change: string } {
  return { confirm: BUTTONS[lang][0], change: BUTTONS[lang][1] }
}

export function reminderTemplateDraft(lang: Lang): TemplateDraft {
  const es = lang === 'es'
  return {
    name: REMINDER_TEMPLATE_NAME,
    category: 'Utility',
    language: lang,
    header: { type: 'none' },
    body: es
      ? 'Hola {{nombre_cliente}}, te recordamos tu {{cita}} el {{fecha}} a las {{hora}} en {{nombre_negocio}}. ¿Nos confirmas tu asistencia?'
      : 'Hi {{nombre_cliente}}, this is a reminder of your {{cita}} on {{fecha}} at {{hora}} at {{nombre_negocio}}. Can you confirm you will attend?',
    footer: '',
    buttons: BUTTONS[lang].map((text) => ({ type: 'quick_reply' as const, text })),
    variables: [
      { key: 'nombre_cliente', label: es ? 'Nombre del cliente' : 'Customer name', example: es ? 'Ana' : 'Ana', source: 'contact.name' },
      { key: 'cita', label: es ? 'Cita' : 'Appointment', example: es ? 'cita de Corte clásico' : 'Haircut appointment', source: 'manual' },
      { key: 'fecha', label: es ? 'Fecha' : 'Date', example: es ? 'sábado 24 de octubre' : 'Saturday, October 24', source: 'manual' },
      { key: 'hora', label: es ? 'Hora' : 'Time', example: '10:00', source: 'manual' },
      { key: 'nombre_negocio', label: es ? 'Negocio' : 'Business', example: es ? 'Barbería Demo' : 'Demo Barbershop', source: 'workspace.name' },
    ],
  }
}

/** Body parameters ({{1}}…) and the quick replies' payloads for one booking. */
export function reminderTemplateComponents(values: Record<ReminderPlaceholder, string>, bookingId: string, lang: Lang) {
  const what = [values.cita, values.servicio].filter(Boolean).join(lang === 'es' ? ' de ' : ' — ')
  const body = [values.nombre || (lang === 'es' ? 'cliente' : 'there'), what, values.fecha, values.hora, values.negocio]
  return {
    components: [
      { type: 'body', parameters: body.map((text) => ({ type: 'text', text })) },
      ...(['confirm', 'change'] as const).map((action, index) => ({
        type: 'button',
        sub_type: 'quick_reply',
        index: String(index),
        parameters: [{ type: 'payload', payload: reminderReplyId(action, bookingId) }],
      })),
    ],
    /** What the customer reads (stored as the message text in the inbox). */
    text:
      lang === 'es'
        ? `Hola ${body[0]}, te recordamos tu ${body[1]} el ${body[2]} a las ${body[3]} en ${body[4]}. ¿Nos confirmas tu asistencia?`
        : `Hi ${body[0]}, this is a reminder of your ${body[1]} on ${body[2]} at ${body[3]} at ${body[4]}. Can you confirm you will attend?`,
  }
}

export interface ReminderTemplateStatus {
  id: string
  status: string
  rejection_reason: string | null
  language: string
}

export async function reminderTemplate(workspaceId: string, lang: Lang): Promise<ReminderTemplateStatus | null> {
  const row = await tenantDb(workspaceId)
    .message_templates.findFirst({
      where: { name: REMINDER_TEMPLATE_NAME, language: lang },
      select: { id: true, status: true, rejection_reason: true, language: true },
    })
    .catch(() => null)
  return row ? { id: row.id, status: row.status ?? 'Draft', rejection_reason: row.rejection_reason, language: row.language ?? lang } : null
}

/**
 * Creates and submits the reminder template of every business with bookings
 * and a connected WhatsApp number that doesn't have it yet (and retries a
 * failed submission once a day). Called by the reminders cron.
 */
export async function ensureReminderTemplates(now = new Date()): Promise<number> {
  const channels = await prisma.channels
    .findMany({ where: { type: 'whatsapp', status: 'connected' }, select: { workspace_id: true }, distinct: ['workspace_id'] })
    .catch(() => [])
  let submitted = 0
  for (const { workspace_id } of channels) {
    const ws = await prisma.workspaces.findUnique({ where: { id: workspace_id }, select: { id: true, locale: true } }).catch(() => null)
    if (!ws) continue
    const lang: Lang = ws.locale === 'en' ? 'en' : 'es'
    const row = await tenantDb(ws.id)
      .message_templates.findFirst({ where: { name: REMINDER_TEMPLATE_NAME, language: lang }, select: { id: true, status: true, updated_at: true } })
      .catch(() => null)
    if (row && (row.status !== 'Draft' || (row.updated_at && now.getTime() - new Date(row.updated_at).getTime() < RETRY_MS))) continue
    const owner = await prisma.workspace_members
      .findFirst({ where: { workspace_id: ws.id, role: 'owner', status: 'active' }, select: { user_id: true } })
      .catch(() => null)
    if (!owner) continue
    try {
      const out = await saveTemplate({ db: tenantDb(ws.id), workspaceId: ws.id, userId: owner.user_id, draft: reminderTemplateDraft(lang), id: row?.id, submit: true })
      if (out.ok && out.submitted) submitted++
      else if (out.ok && out.error) console.warn(`[reminders] template not submitted for ${ws.id}:`, out.error)
    } catch (err) {
      console.error(`[reminders] template creation failed for ${ws.id}:`, err instanceof Error ? err.message : err)
    }
  }
  return submitted
}

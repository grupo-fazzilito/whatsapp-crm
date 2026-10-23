import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { reminderSettings } from '@/lib/bookings/reminder-settings'
import { reminderTemplate } from '@/lib/bookings/reminder-template'
import { buildBookingMessage } from '@/lib/bookings/messages'
import type { ReminderKind } from '@/lib/bookings/reminders'

/**
 * GET /api/business/reminders (members) → what Automations → Reminders shows:
 *   { settings: { off, texts }, defaults: { '24h'|'4h'|'2h': sample default text },
 *     whatsapp: boolean, template: { id, status, rejection_reason } | null }
 * Settings are saved with PATCH /api/business/workspace { settings: { booking_reminders } }.
 */
export async function GET() {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { db, workspace } = guard.ctx
  const lang = workspace.locale === 'en' ? 'en' : 'es'
  const [template, whatsapp] = await Promise.all([
    reminderTemplate(workspace.id, lang),
    db.channels.count({ where: { type: 'whatsapp', status: 'connected' } }).catch(() => 0),
  ])
  const sample = (kind: ReminderKind) =>
    buildBookingMessage(`reminder_${kind}`, {
      locale: lang,
      industry: workspace.industry,
      settings: workspace.settings,
      businessName: workspace.name,
      customerName: 'Ana',
      serviceName: lang === 'es' ? 'Corte clásico' : 'Haircut',
      date: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
      time: '10:00',
    })
  return NextResponse.json({
    settings: reminderSettings(workspace.settings),
    defaults: { '24h': sample('24h'), '4h': sample('4h'), '2h': sample('2h') },
    whatsapp: whatsapp > 0,
    template: template ? { id: template.id, status: template.status, rejection_reason: template.rejection_reason } : null,
  })
}

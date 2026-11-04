import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { ensureWaitlistTemplate, waitlistTemplate } from '@/lib/waitlist/template'

/**
 * GET /api/waitlist/template → { template: { id, status, rejection_reason } | null, whatsapp }
 * "Notificar llegada de stock": the draft is created when missing (never sent
 * to Meta here; the business sends it with POST /api/whatsapp/templates/:id/submit).
 */
export async function GET() {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { workspace, db, user } = guard.ctx
  const lang = workspace.locale === 'en' ? 'en' : 'es'
  let template = await waitlistTemplate(workspace.id, lang)
  if (!template) {
    await ensureWaitlistTemplate(workspace.id, user.id)
    template = await waitlistTemplate(workspace.id, lang)
  }
  const whatsapp = await db.channels.count({ where: { type: 'whatsapp', status: 'connected' } })
  return NextResponse.json({
    template: template ? { id: template.id, status: template.status, rejection_reason: template.rejection_reason } : null,
    whatsapp: whatsapp > 0,
  })
}

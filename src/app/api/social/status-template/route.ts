import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { ensureStatusTemplate, statusTemplate } from '@/lib/social/whatsapp-status'

/**
 * GET → { template: { id, status, rejection_reason } | null, whatsapp }
 * "Estado listo para publicar": the draft is created when missing (it goes to
 * Meta only when the business presses "Send to Meta").
 */
export async function GET() {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { workspace, db, user } = guard.ctx
  const lang = workspace.locale === 'en' ? 'en' : 'es'
  let template = await statusTemplate(workspace.id, lang)
  if (!template) {
    await ensureStatusTemplate(workspace.id, user.id)
    template = await statusTemplate(workspace.id, lang)
  }
  const whatsapp = await db.channels.count({ where: { type: 'whatsapp', status: 'connected' } })
  return NextResponse.json({
    template: template ? { id: template.id, status: template.status, rejection_reason: template.rejection_reason } : null,
    whatsapp: whatsapp > 0,
  })
}

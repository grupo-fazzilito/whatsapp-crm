import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { parseDraft, saveTemplate, templateView } from '@/lib/templates/server'

/**
 * GET  /api/whatsapp/templates → { templates } newest first (any member)
 * POST /api/whatsapp/templates { draft, channel_id?, submit? } (admins)
 *   Saves the template (Draft) and, with submit, sends it to Meta for review.
 *   → 201 { template, submitted, error? } | 422 { error: 'invalid', issues } | 409 { error: 'name_taken' }
 */
export async function GET() {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  try {
    const templates = await guard.ctx.db.message_templates.findMany({ orderBy: { created_at: 'desc' } })
    return NextResponse.json({ templates: templates.map((t) => templateView(t)) })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const { db, user, workspace } = guard.ctx
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const draft = parseDraft(body?.draft)
  if (!draft) return NextResponse.json({ error: 'draft_required' }, { status: 400 })
  try {
    const out = await saveTemplate({ db, workspaceId: workspace.id, userId: user.id, draft, channelId: typeof body?.channel_id === 'string' ? body.channel_id : null, submit: body?.submit === true })
    if (!out.ok) return NextResponse.json(out.body, { status: out.status })
    return NextResponse.json({ template: out.template, submitted: out.submitted, ...(out.error ? { error: out.error } : {}) }, { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}

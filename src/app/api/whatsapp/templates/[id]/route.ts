import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'
import { loadChannel } from '@/lib/channels/store'
import { deleteTemplate } from '@/lib/templates/meta'
import { parseDraft, saveTemplate, templateView } from '@/lib/templates/server'

type Ctx = { params: Promise<{ id: string }> }

/** GET → { template } (any member). */
export async function GET(_request: Request, { params }: Ctx) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const template = await guard.ctx.db.message_templates.findFirst({ where: { id } })
  if (!template) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ template: templateView(template) })
}

/** PUT { draft, submit? } → { template, submitted, error? } (admins; not while in review). */
export async function PUT(request: Request, { params }: Ctx) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const draft = parseDraft(body?.draft)
  if (!draft) return NextResponse.json({ error: 'draft_required' }, { status: 400 })
  try {
    const out = await saveTemplate({ db: guard.ctx.db, workspaceId: guard.ctx.workspace.id, userId: guard.ctx.user.id, draft, id, submit: body?.submit === true })
    if (!out.ok) return NextResponse.json(out.body, { status: out.status })
    return NextResponse.json({ template: out.template, submitted: out.submitted, ...(out.error ? { error: out.error } : {}) })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}

/** DELETE — removes the template here and, if it was submitted, in Meta too (admins). */
export async function DELETE(_request: Request, { params }: Ctx) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const { db, workspace } = guard.ctx
  try {
    const row = await db.message_templates.findFirst({ where: { id } })
    if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    if (row.meta_template_id && row.channel_id) {
      const channel = await loadChannel(workspace.id, row.channel_id)
      if (channel) {
        try {
          await deleteTemplate(channel, row.name, row.meta_template_id)
        } catch (err) {
          // Already gone in Meta is fine; anything else stops the delete.
          const message = err instanceof Error ? err.message : String(err)
          if (!/not.*(exist|found)/i.test(message)) return NextResponse.json({ error: message }, { status: 502 })
        }
      }
    }
    await db.message_templates.deleteMany({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}

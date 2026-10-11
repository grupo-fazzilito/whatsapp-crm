import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'
import { draftFromRow, saveTemplate } from '@/lib/templates/server'

/** POST → sends a saved draft (or a rejected template) to Meta for review. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const row = await guard.ctx.db.message_templates.findFirst({ where: { id } })
  if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  try {
    const out = await saveTemplate({ db: guard.ctx.db, workspaceId: guard.ctx.workspace.id, userId: guard.ctx.user.id, draft: draftFromRow(row), id, submit: true })
    if (!out.ok) return NextResponse.json(out.body, { status: out.status })
    return NextResponse.json({ template: out.template, submitted: out.submitted, ...(out.error ? { error: out.error } : {}) })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}

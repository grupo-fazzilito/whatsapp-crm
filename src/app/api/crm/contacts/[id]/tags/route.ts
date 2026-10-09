import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'
import { isPrismaError } from '@/lib/db/errors'
import { owns } from '@/lib/crm/server'

/** GET /api/crm/contacts/[id]/tags — any member. → { tag_ids } */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { id } = await ctx.params
  if (!isUuid(id)) return NextResponse.json({ tag_ids: [] })
  const rows = await guard.ctx.db.contact_tags.findMany({ select: { tag_id: true }, where: { contact_id: id } })
  return NextResponse.json({ tag_ids: rows.map((r) => r.tag_id) })
}

/** POST /api/crm/contacts/[id]/tags { tag_id } — any member; adds the tag. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { db, workspace } = guard.ctx
  const { id } = await ctx.params
  const body = (await request.json().catch(() => null)) as { tag_id?: unknown } | null
  const tagId = typeof body?.tag_id === 'string' ? body.tag_id : ''
  if (!(await owns(db, 'contacts', id)) || !(await owns(db, 'tags', tagId))) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  try {
    await db.contact_tags.create({ data: { workspace_id: workspace.id, contact_id: id, tag_id: tagId } })
  } catch (err) {
    if (!isPrismaError(err, 'P2002')) return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}

/** DELETE /api/crm/contacts/[id]/tags { tag_id } — any member; removes the tag. */
export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { id } = await ctx.params
  const body = (await request.json().catch(() => null)) as { tag_id?: unknown } | null
  const tagId = typeof body?.tag_id === 'string' ? body.tag_id : ''
  if (!isUuid(id) || !isUuid(tagId)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  await guard.ctx.db.contact_tags.deleteMany({ where: { contact_id: id, tag_id: tagId } })
  return NextResponse.json({ ok: true })
}

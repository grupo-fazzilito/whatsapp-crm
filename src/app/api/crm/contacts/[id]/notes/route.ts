import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'
import { clip, owns } from '@/lib/crm/server'

/** GET /api/crm/contacts/[id]/notes — any member. Newest first. → { notes } */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { id } = await ctx.params
  if (!isUuid(id)) return NextResponse.json({ notes: [] })
  const notes = await guard.ctx.db.contact_notes.findMany({ where: { contact_id: id }, orderBy: { created_at: 'desc' } })
  return NextResponse.json({ notes })
}

/** POST /api/crm/contacts/[id]/notes { note_text } — any member. → { note } */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { db, workspace, user } = guard.ctx
  const { id } = await ctx.params
  const body = (await request.json().catch(() => null)) as { note_text?: unknown } | null
  const text = clip(body?.note_text, 10000)
  if (!text) return NextResponse.json({ error: 'invalid' }, { status: 400 })
  if (!(await owns(db, 'contacts', id))) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const note = await db.contact_notes.create({ data: { workspace_id: workspace.id, contact_id: id, user_id: user.id, note_text: text } })
  return NextResponse.json({ note }, { status: 201 })
}

/** DELETE /api/crm/contacts/[id]/notes { note_id } — any member. */
export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { id } = await ctx.params
  const body = (await request.json().catch(() => null)) as { note_id?: unknown } | null
  const noteId = typeof body?.note_id === 'string' ? body.note_id : ''
  if (!isUuid(id) || !isUuid(noteId)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const { count } = await guard.ctx.db.contact_notes.deleteMany({ where: { id: noteId, contact_id: id } })
  if (!count) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}

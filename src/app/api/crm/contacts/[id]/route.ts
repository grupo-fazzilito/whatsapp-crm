import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'
import { clip, owns } from '@/lib/crm/server'

/** GET /api/crm/contacts/[id] — any member. → { contact } (all columns). */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { id } = await ctx.params
  const contact = isUuid(id) ? await guard.ctx.db.contacts.findFirst({ where: { id } }) : null
  if (!contact) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ contact })
}

/**
 * PATCH /api/crm/contacts/[id] { phone?, name?, email?, company?, tag_ids? } — any member.
 * Only the keys sent change (empty clears; contacts from Instagram, Messenger
 * or web chat have no phone). tag_ids, when present, replaces the contact's tags.
 */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { db, workspace } = guard.ctx
  const { id } = await ctx.params
  if (!isUuid(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'invalid' }, { status: 400 })
  const data: Record<string, string | null> = {}
  for (const [key, max] of [['phone', 50], ['name', 200], ['email', 200], ['company', 200]] as const) {
    if (key in body) data[key] = clip(body[key], max)
  }
  const tagIds = body.tag_ids
  if (tagIds !== undefined) {
    if (!Array.isArray(tagIds) || tagIds.length > 100) return NextResponse.json({ error: 'invalid_tags' }, { status: 400 })
    for (const t of tagIds) if (typeof t !== 'string' || !(await owns(db, 'tags', t))) return NextResponse.json({ error: 'invalid_tags' }, { status: 400 })
  }
  try {
    const { count } = await db.contacts.updateMany({
      where: { id },
      data: { ...data, updated_at: new Date().toISOString() },
    })
    if (!count) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    if (Array.isArray(tagIds)) {
      await db.contact_tags.deleteMany({ where: { contact_id: id } })
      if (tagIds.length) {
        await db.contact_tags.createMany({ data: [...new Set(tagIds as string[])].map((tag_id) => ({ workspace_id: workspace.id, contact_id: id, tag_id })) })
      }
    }
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}

import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { clip, owns } from '@/lib/crm/server'

/** GET /api/crm/contacts — any member. Up to 1000 contacts by name (deal form picker). → { contacts } */
export async function GET() {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  try {
    const contacts = await guard.ctx.db.contacts.findMany({ orderBy: { name: 'asc' }, take: 1000 })
    return NextResponse.json({ contacts })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}

/** POST /api/crm/contacts { phone, name?, email?, company?, tag_ids? } — any member. → { contact: { id } } */
export async function POST(request: Request) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { db, workspace, user } = guard.ctx
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const phone = clip(body?.phone, 50)
  if (!body || !phone) return NextResponse.json({ error: 'phone_required' }, { status: 400 })
  const tagIds = body.tag_ids === undefined ? [] : body.tag_ids
  if (!Array.isArray(tagIds) || tagIds.length > 100) return NextResponse.json({ error: 'invalid_tags' }, { status: 400 })
  for (const t of tagIds) if (typeof t !== 'string' || !(await owns(db, 'tags', t))) return NextResponse.json({ error: 'invalid_tags' }, { status: 400 })
  try {
    const contact = await db.contacts.create({
      data: { workspace_id: workspace.id, user_id: user.id, phone, name: clip(body.name, 200), email: clip(body.email, 200), company: clip(body.company, 200) },
      select: { id: true },
    })
    if (tagIds.length) {
      await db.contact_tags.createMany({ data: [...new Set(tagIds as string[])].map((tag_id) => ({ workspace_id: workspace.id, contact_id: contact.id, tag_id })) })
    }
    return NextResponse.json({ contact }, { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}

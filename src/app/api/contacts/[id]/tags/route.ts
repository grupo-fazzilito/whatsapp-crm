import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'

/** GET /api/contacts/[id]/tags → { contact_tags } rows of the contact (any member). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ contact_tags: [] })
  try {
    const contactTags = await guard.ctx.db.contact_tags.findMany({ where: { contact_id: id } })
    return NextResponse.json({ contact_tags: contactTags })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}

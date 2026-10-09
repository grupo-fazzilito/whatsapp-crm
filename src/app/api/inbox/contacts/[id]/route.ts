import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'
import { contactPanel } from '@/lib/inbox/queries'

/** GET /api/inbox/contacts/[id] → { deals (with stage), notes, tags: [{id, tag_id, tags}], identities } */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  try {
    const panel = await contactPanel(guard.ctx.db, id)
    if (!panel) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(panel)
  } catch (err) {
    console.error('[inbox] contact panel failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Failed to load contact' }, { status: 500 })
  }
}

import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'

type Ctx = { params: Promise<{ id: string }> }

/** DELETE /api/waitlist/:id — takes someone off the list. */
export async function DELETE(_request: Request, { params }: Ctx) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const { count } = await guard.ctx.db.stock_waitlist.deleteMany({ where: { id } })
  if (!count) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}

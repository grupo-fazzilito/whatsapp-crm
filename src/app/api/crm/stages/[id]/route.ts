import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'

/** DELETE /api/crm/stages/[id] — admins. 409 { error: 'stage_has_deals' } while deals use it. */
export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const { db } = guard.ctx
  const { id } = await ctx.params
  if (!isUuid(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if ((await db.deals.count({ where: { stage_id: id } })) > 0) return NextResponse.json({ error: 'stage_has_deals' }, { status: 409 })
  try {
    const { count } = await db.pipeline_stages.deleteMany({ where: { id } })
    if (!count) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}

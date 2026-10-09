import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'
import { parseDealInput } from '@/lib/crm/server'

/**
 * PATCH /api/crm/deals/[id] — any member. Any of title, value, currency,
 * contact_id, pipeline_id + stage_id, assigned_to, notes, expected_close_date.
 * (Won / lost / reopen: POST /api/deals/[id]/status.)
 */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { db } = guard.ctx
  const { id } = await ctx.params
  const current = isUuid(id) ? await db.deals.findFirst({ select: { pipeline_id: true, stage_id: true }, where: { id } }) : null
  if (!current) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'invalid' }, { status: 400 })
  for (const k of ['status', 'won_at', 'lost_at', 'lost_reason', 'close_note', 'workspace_id']) delete body[k]
  const parsed = await parseDealInput(db, body, 'update', current)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  try {
    const { count } = await db.deals.updateMany({ where: { id }, data: parsed.data })
    if (!count) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}

/** DELETE /api/crm/deals/[id] — any member. */
export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { id } = await ctx.params
  if (!isUuid(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  try {
    const { count } = await guard.ctx.db.deals.deleteMany({ where: { id } })
    if (!count) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}

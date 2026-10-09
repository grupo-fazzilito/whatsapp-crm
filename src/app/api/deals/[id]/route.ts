import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'

/**
 * GET   /api/deals/[id] → { deal: {id, pipeline_id, stage_id, status} } (any member; 404 outside the workspace)
 * PATCH /api/deals/[id] { stage_id } — moves the deal to another stage of
 *       its pipeline (any member). → { deal: {id, stage_id} }
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  try {
    const deal = await guard.ctx.db.deals.findFirst({
      select: { id: true, pipeline_id: true, stage_id: true, status: true },
      where: { id },
    })
    if (!deal) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    return NextResponse.json({ deal })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { db } = guard.ctx
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const stageId = body?.stage_id
  if (typeof stageId !== 'string' || !isUuid(stageId)) return NextResponse.json({ error: 'invalid_stage' }, { status: 400 })

  try {
    const deal = await db.deals.findFirst({ select: { id: true, pipeline_id: true }, where: { id } })
    if (!deal) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    // The stage must belong to this workspace and to the deal's pipeline.
    const stage = await db.pipeline_stages.findFirst({ select: { id: true }, where: { id: stageId, pipeline_id: deal.pipeline_id } })
    if (!stage) return NextResponse.json({ error: 'invalid_stage' }, { status: 400 })
    await db.deals.updateMany({ where: { id }, data: { stage_id: stageId } })
    return NextResponse.json({ deal: { id, stage_id: stageId } })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}

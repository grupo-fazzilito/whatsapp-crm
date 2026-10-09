import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'

/** GET /api/pipelines/[id]/stages → { stages } by position (any member). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ stages: [] })
  try {
    const stages = await guard.ctx.db.pipeline_stages.findMany({ where: { pipeline_id: id }, orderBy: { position: 'asc' } })
    return NextResponse.json({ stages })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}

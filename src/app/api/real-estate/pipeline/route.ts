import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { ensureRealEstatePipeline, realEstatePipelineId } from '@/lib/real-estate/pipeline'

/** GET /api/real-estate/pipeline → { pipelineId | null } (any member). */
export async function GET() {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  return NextResponse.json({ pipelineId: await realEstatePipelineId(guard.ctx.workspace.id) })
}

/**
 * POST /api/real-estate/pipeline — admins. Creates the real-estate sales
 * pipeline (idempotent; returns the existing one with created=false).
 */
export async function POST() {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const wsId = guard.ctx.workspace.id
  try {
    const existing = await realEstatePipelineId(wsId)
    const pipelineId = await ensureRealEstatePipeline(wsId)
    if (!pipelineId) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    return NextResponse.json({ pipelineId, created: !existing })
  } catch (err) {
    console.error('[real-estate/pipeline]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'failed' }, { status: 500 })
  }
}

import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'

/** GET /api/crm/pipelines — any member. → { pipelines: [{ id, name }] (oldest first), stages (by position) } */
export async function GET() {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { db } = guard.ctx
  try {
    const [pipelines, stages] = await Promise.all([
      db.pipelines.findMany({ select: { id: true, name: true }, orderBy: { created_at: 'asc' } }),
      db.pipeline_stages.findMany({ select: { id: true, name: true, position: true, pipeline_id: true, color: true }, orderBy: { position: 'asc' } }),
    ])
    return NextResponse.json({ pipelines, stages })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}

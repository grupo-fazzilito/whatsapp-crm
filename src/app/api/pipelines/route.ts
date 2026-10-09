import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'

const MAX_STAGES = 30
const COLOR_RE = /^#[0-9a-f]{3,8}$/i

/**
 * GET  /api/pipelines → { pipelines } oldest first (any member)
 * POST /api/pipelines { name, stages?: {name, color?, position?}[] } — admins.
 *   Creates the pipeline and its stages together. → { pipeline }
 */
export async function GET() {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  try {
    const pipelines = await guard.ctx.db.pipelines.findMany({ orderBy: { created_at: 'asc' } })
    return NextResponse.json({ pipelines })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const { db, user, workspace } = guard.ctx

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 200) : ''
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 })
  const rawStages = Array.isArray(body?.stages) ? (body.stages as unknown[]).slice(0, MAX_STAGES) : []
  const stages = rawStages
    .map((s, i) => {
      const r = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>
      const stageName = typeof r.name === 'string' ? r.name.trim().slice(0, 200) : ''
      if (!stageName) return null
      return {
        name: stageName,
        position: Number.isInteger(r.position) ? (r.position as number) : i,
        ...(typeof r.color === 'string' && COLOR_RE.test(r.color) ? { color: r.color } : {}),
      }
    })
    .filter((s): s is NonNullable<typeof s> => s !== null)

  try {
    const pipeline = await db.$transaction(async (tx) => {
      const p = await tx.pipelines.create({ data: { workspace_id: workspace.id, user_id: user.id, name } })
      if (stages.length) {
        await tx.pipeline_stages.createMany({
          data: stages.map((s) => ({ ...s, pipeline_id: p.id, workspace_id: workspace.id })),
        })
      }
      return p
    })
    return NextResponse.json({ pipeline })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}

import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { clip, owns } from '@/lib/crm/server'

/** POST /api/crm/pipelines/[id]/stages { name, color, position } — admins. → { stage } */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const { db, workspace } = guard.ctx
  const { id } = await ctx.params
  if (!(await owns(db, 'pipelines', id))) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const body = (await request.json().catch(() => null)) as { name?: unknown; color?: unknown; position?: unknown } | null
  const name = clip(body?.name, 120)
  const color = typeof body?.color === 'string' && body.color.trim() && body.color.length <= 32 ? body.color.trim() : undefined
  if (!name) return NextResponse.json({ error: 'invalid' }, { status: 400 })
  try {
    const stage = await db.pipeline_stages.create({
      data: { workspace_id: workspace.id, pipeline_id: id, name, color, position: Number.isInteger(body?.position) ? (body!.position as number) : 0 },
    })
    return NextResponse.json({ stage }, { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}

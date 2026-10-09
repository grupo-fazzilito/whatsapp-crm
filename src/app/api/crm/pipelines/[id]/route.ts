import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'
import { clip } from '@/lib/crm/server'

/**
 * PUT /api/crm/pipelines/[id] { name, stages: [{ id, name, color }] in order } — admins.
 * Renames the pipeline and saves its stages' names, colors and positions.
 */
export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const { db } = guard.ctx
  const { id } = await ctx.params
  if (!isUuid(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const body = (await request.json().catch(() => null)) as { name?: unknown; stages?: unknown } | null
  const name = clip(body?.name, 120)
  const stages = body?.stages
  if (!name || !Array.isArray(stages) || stages.length > 100) return NextResponse.json({ error: 'invalid' }, { status: 400 })
  const parsed: { id: string; name: string; color: string }[] = []
  for (const s of stages as Record<string, unknown>[]) {
    const sname = typeof s?.name === 'string' ? s.name.trim().slice(0, 120) : null
    const color = typeof s?.color === 'string' && s.color.trim() && s.color.length <= 32 ? s.color.trim() : null
    if (typeof s?.id !== 'string' || !isUuid(s.id) || sname === null || !color) return NextResponse.json({ error: 'invalid' }, { status: 400 })
    parsed.push({ id: s.id, name: sname, color })
  }
  const own = new Set((await db.pipeline_stages.findMany({ select: { id: true }, where: { pipeline_id: id } })).map((s) => s.id))
  if (parsed.some((s) => !own.has(s.id))) return NextResponse.json({ error: 'invalid_stage' }, { status: 400 })
  try {
    const { count } = await db.pipelines.updateMany({ where: { id }, data: { name } })
    if (!count) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    await Promise.all(parsed.map((s, i) => db.pipeline_stages.updateMany({ where: { id: s.id, pipeline_id: id }, data: { name: s.name, color: s.color, position: i } })))
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}

/** DELETE /api/crm/pipelines/[id] — admins. Stages and deals go with it (ON DELETE CASCADE). */
export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const { id } = await ctx.params
  if (!isUuid(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  try {
    const { count } = await guard.ctx.db.pipelines.deleteMany({ where: { id } })
    if (!count) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}

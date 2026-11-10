import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'
import { clip } from '@/lib/crm/server'
import { STAGE_FACTS, type StageFact } from '@/lib/crm/stage-facts'

/**
 * PUT /api/crm/pipelines/[id] { name, stages: [{ id, name, color, ai_hint?, ai_events? }] in order } — admins.
 * Renames the pipeline and saves its stages' names, colors, positions and what
 * they mean for the AI agent (ai_hint text; ai_events: facts that move deals there).
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
  const parsed: { id: string; name: string; color: string; ai_hint?: string | null; ai_events?: string[] }[] = []
  for (const s of stages as Record<string, unknown>[]) {
    const sname = typeof s?.name === 'string' ? s.name.trim().slice(0, 120) : null
    const color = typeof s?.color === 'string' && s.color.trim() && s.color.length <= 32 ? s.color.trim() : null
    if (typeof s?.id !== 'string' || !isUuid(s.id) || sname === null || !color) return NextResponse.json({ error: 'invalid' }, { status: 400 })
    const hint = 'ai_hint' in s ? (typeof s.ai_hint === 'string' ? s.ai_hint.trim().slice(0, 500) || null : null) : undefined
    const events = Array.isArray(s.ai_events) ? [...new Set(s.ai_events.filter((e): e is StageFact => (STAGE_FACTS as readonly unknown[]).includes(e)))] : undefined
    parsed.push({ id: s.id, name: sname, color, ...(hint !== undefined ? { ai_hint: hint } : {}), ...(events ? { ai_events: events } : {}) })
  }
  const own = new Set((await db.pipeline_stages.findMany({ select: { id: true }, where: { pipeline_id: id } })).map((s) => s.id))
  if (parsed.some((s) => !own.has(s.id))) return NextResponse.json({ error: 'invalid_stage' }, { status: 400 })
  try {
    const { count } = await db.pipelines.updateMany({ where: { id }, data: { name } })
    if (!count) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    // A fact moves deals to one stage only: the first stage that claims it keeps it.
    const claimed = new Set<string>()
    for (const s of parsed) if (s.ai_events) s.ai_events = s.ai_events.filter((e) => !claimed.has(e) && claimed.add(e))
    await Promise.all(parsed.map((s, i) => db.pipeline_stages.updateMany({ where: { id: s.id, pipeline_id: id }, data: { name: s.name, color: s.color, position: i, ...(s.ai_hint !== undefined ? { ai_hint: s.ai_hint } : {}), ...(s.ai_events ? { ai_events: s.ai_events } : {}) } })))
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

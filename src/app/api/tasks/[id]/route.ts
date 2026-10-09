import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'
import { isPrismaError } from '@/lib/db/errors'
import { TASK_INCLUDE, parseTaskInput, taskRow } from '@/lib/crm/server'

/** GET /api/tasks/[id] — any member. → { task } (404 when missing). */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { id } = await ctx.params
  if (!isUuid(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const task = await guard.ctx.db.tasks.findFirst({ where: { id }, include: TASK_INCLUDE })
  if (!task) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ task: taskRow(task) })
}

/**
 * PATCH /api/tasks/[id] — any member. Any of title, description, due_at,
 * priority, assignee_user_id, contact_id, conversation_id, deal_id,
 * status ('open' | 'cancelled'; completing goes through /complete), result.
 */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { db } = guard.ctx
  const { id } = await ctx.params
  if (!isUuid(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'invalid' }, { status: 400 })
  const parsed = await parseTaskInput(db, body, 'update')
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  try {
    const task = await db.tasks.update({ where: { id }, data: parsed.data, include: TASK_INCLUDE })
    return NextResponse.json({ task: taskRow(task) })
  } catch (err) {
    if (isPrismaError(err, 'P2025')) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}

/** DELETE /api/tasks/[id] — any member. */
export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { id } = await ctx.params
  if (!isUuid(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const { count } = await guard.ctx.db.tasks.deleteMany({ where: { id } })
  if (!count) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}

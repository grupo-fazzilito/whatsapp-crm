import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'
import { TASK_INCLUDE, listTasks, parseTaskInput, taskRow } from '@/lib/crm/server'

/**
 * GET /api/tasks?status=open|done&mine=1&contact_id=&limit= — any member.
 * Open tasks soonest due first (no due date last); done tasks latest first.
 * → { tasks } with contact { id, name, phone } and deal { id, title }.
 */
export async function GET(request: Request) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { db, user } = guard.ctx
  const sp = new URL(request.url).searchParams
  const contactId = sp.get('contact_id')
  if (contactId && !isUuid(contactId)) return NextResponse.json({ tasks: [] })
  const limit = Math.min(Math.max(Number(sp.get('limit')) || 500, 1), 1000)
  try {
    const tasks = await listTasks(db, {
      status: sp.get('status') === 'done' ? 'done' : 'open',
      assignee: sp.get('mine') === '1' ? user.id : null,
      contactId,
      limit,
    })
    return NextResponse.json({ tasks })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}

/**
 * POST /api/tasks { title, description?, due_at?, priority?, assignee_user_id?,
 * contact_id?, conversation_id?, deal_id? } — any member. → { task }
 */
export async function POST(request: Request) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { db, workspace, user } = guard.ctx
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'invalid' }, { status: 400 })
  const parsed = await parseTaskInput(db, body, 'create')
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  try {
    const task = await db.tasks.create({
      data: { ...parsed.data, title: parsed.data.title as string, workspace_id: workspace.id, created_by: user.id },
      include: TASK_INCLUDE,
    })
    return NextResponse.json({ task: taskRow(task) }, { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}

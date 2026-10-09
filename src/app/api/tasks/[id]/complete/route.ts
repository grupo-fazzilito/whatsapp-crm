import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'
import { isPrismaError } from '@/lib/db/errors'

// Same row as TASK_SELECT ('*, contact:contacts(id, name, phone), deal:deals(id, title)').
const TASK_INCLUDE = { contacts: { select: { id: true, name: true, phone: true } }, deals: { select: { id: true, title: true } } } as const
function taskRow<T extends { contacts: unknown; deals: unknown }>({ contacts, deals, ...rest }: T) {
  return { ...rest, contact: contacts, deal: deals }
}

const clip = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)

/**
 * POST /api/tasks/[id]/complete {result?, follow_up?: {title, due_at?}} — any member.
 * Marks the task done (completed_at from the tasks trigger, completed_by is
 * the signed-in user) and optionally schedules a follow-up task with the
 * same contact / conversation / deal / assignee.
 */
export async function POST(request: Request, ctx: RouteContext<'/api/tasks/[id]/complete'>) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { db, workspace, user } = guard.ctx

  const { id } = await ctx.params
  if (!isUuid(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown> | null
  const result = clip(body?.result, 5000)
  const fu = (body?.follow_up ?? null) as Record<string, unknown> | null
  const fuTitle = fu ? clip(fu.title, 300) : null
  let fuDue: string | null = null
  if (fu && typeof fu.due_at === 'string' && fu.due_at) {
    const d = new Date(fu.due_at)
    if (Number.isNaN(d.getTime())) return NextResponse.json({ error: 'invalid_due_at' }, { status: 400 })
    fuDue = d.toISOString()
  }
  if (fu && !fuTitle) return NextResponse.json({ error: 'invalid_follow_up' }, { status: 400 })

  // No session user in the database any more: completed_by is passed (the trigger keeps it).
  const completeTask = () =>
    db.tasks.update({ where: { id, status: 'open' }, data: { status: 'done', result, completed_by: user.id }, include: TASK_INCLUDE })
  let task: ReturnType<typeof taskRow<Awaited<ReturnType<typeof completeTask>>>> | null = null
  try {
    task = taskRow(await completeTask())
  } catch (err) {
    if (!isPrismaError(err, 'P2025')) return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
  if (!task) {
    const exists = await db.tasks.findFirst({ select: { status: true }, where: { id } })
    return exists
      ? NextResponse.json({ error: 'not_open' }, { status: 409 })
      : NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  let followUp = null
  if (fuTitle) {
    try {
      const data = await db.tasks.create({
        data: {
          workspace_id: workspace.id,
          title: fuTitle,
          due_at: fuDue,
          priority: task.priority,
          assignee_user_id: task.assignee_user_id,
          contact_id: task.contact_id,
          conversation_id: task.conversation_id,
          deal_id: task.deal_id,
          created_by: user.id,
        },
        include: TASK_INCLUDE,
      })
      followUp = taskRow(data)
    } catch {
      return NextResponse.json({ task, error: 'follow_up_failed' }, { status: 207 })
    }
  }

  return NextResponse.json({ task, followUp })
}

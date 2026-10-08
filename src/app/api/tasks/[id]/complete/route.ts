import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'
import { TASK_SELECT } from '@/lib/crm/tasks'

const clip = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)

/**
 * POST /api/tasks/[id]/complete {result?, follow_up?: {title, due_at?}} — any member.
 * Marks the task done (completed_at / completed_by come from the session via
 * the tasks trigger) and optionally schedules a follow-up task with the
 * same contact / conversation / deal / assignee.
 */
export async function POST(request: Request, ctx: RouteContext<'/api/tasks/[id]/complete'>) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { supabase, workspace } = guard.ctx

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

  const { data: task, error } = await supabase
    .from('tasks')
    .update({ status: 'done', result })
    .eq('id', id)
    .eq('workspace_id', workspace.id)
    .eq('status', 'open')
    .select(TASK_SELECT)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!task) {
    const { data: exists } = await supabase.from('tasks').select('status').eq('id', id).eq('workspace_id', workspace.id).maybeSingle()
    return exists
      ? NextResponse.json({ error: 'not_open' }, { status: 409 })
      : NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  let followUp = null
  if (fuTitle) {
    const { data, error: fuError } = await supabase
      .from('tasks')
      .insert({
        workspace_id: workspace.id,
        title: fuTitle,
        due_at: fuDue,
        priority: task.priority,
        assignee_user_id: task.assignee_user_id,
        contact_id: task.contact_id,
        conversation_id: task.conversation_id,
        deal_id: task.deal_id,
      })
      .select(TASK_SELECT)
      .single()
    if (fuError) return NextResponse.json({ task, error: 'follow_up_failed' }, { status: 207 })
    followUp = data
  }

  return NextResponse.json({ task, followUp })
}

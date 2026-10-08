import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'
import { isPriority } from '@/lib/inbox/priority'
import {
  contactNameOf,
  markAssigned,
  memberNames,
  notify,
  recordEvent,
  teamOf,
} from '@/lib/inbox/server'
import { notificationText } from '@/lib/inbox/texts'

/**
 * PATCH /api/conversations/[id]
 * Body (all optional):
 *   assigned_agent_id: string | null — auth user id of an active member, null unassigns
 *   status: 'open' | 'pending' | 'closed'   ('closed' is shown as "Resuelta")
 *   ai_paused_until: 'pause' | 'resume'
 *     'pause'  → AI quiet for 12 h; also assigns the conversation to the
 *                caller unless assigned_agent_id is given explicitly.
 *     'resume' → hands the conversation back to the AI agent.
 *   ai_agent_id: string | null — AI agent that owns this conversation
 *     (an enabled agent of the workspace); null = fall back to the
 *     channel's routing (welcome menu / channel agent).
 *   priority: 'low' | 'normal' | 'high' | 'urgent'
 *   team_id: string | null — team of the workspace
 * Any member (agent role) may call it. Changes of status, assignee and
 * priority are recorded in conversation_events; a new assignee gets a
 * notification. Returns { conversation }.
 */

const AI_PAUSE_HOURS = 12
const STATUSES = new Set(['open', 'pending', 'closed'])

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { supabase, user, workspace } = guard.ctx

  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid conversation id' }, { status: 400 })

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { data: current } = await supabase
    .from('conversations')
    .select('id, status, assigned_agent_id, priority, team_id')
    .eq('id', id)
    .eq('workspace_id', workspace.id)
    .maybeSingle()
  if (!current) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })

  const update: Record<string, unknown> = {}

  if ('status' in body) {
    if (typeof body.status !== 'string' || !STATUSES.has(body.status)) {
      return NextResponse.json({ error: 'status must be open, pending or closed' }, { status: 400 })
    }
    update.status = body.status
    if (body.status === 'closed' && current.status !== 'closed') {
      update.resolved_at = new Date().toISOString()
      update.resolved_by = user.id
    } else if (body.status !== 'closed' && current.status === 'closed') {
      update.resolved_at = null
      update.resolved_by = null
    }
  }

  if ('priority' in body) {
    if (!isPriority(body.priority)) {
      return NextResponse.json({ error: 'priority must be low, normal, high or urgent' }, { status: 400 })
    }
    update.priority = body.priority
  }

  if ('ai_paused_until' in body) {
    if (body.ai_paused_until === 'pause') {
      update.ai_paused_until = new Date(Date.now() + AI_PAUSE_HOURS * 3600_000).toISOString()
      if (!('assigned_agent_id' in body)) update.assigned_agent_id = user.id
    } else if (body.ai_paused_until === 'resume') {
      update.ai_paused_until = null
    } else {
      return NextResponse.json({ error: "ai_paused_until must be 'pause' or 'resume'" }, { status: 400 })
    }
  }

  if ('assigned_agent_id' in body) {
    const agentId = body.assigned_agent_id
    if (agentId === null) {
      update.assigned_agent_id = null
    } else if (typeof agentId === 'string' && isUuid(agentId)) {
      // Only active members of this workspace can be assigned.
      const { data: member } = await supabase
        .from('workspace_members')
        .select('user_id')
        .eq('workspace_id', workspace.id)
        .eq('user_id', agentId)
        .eq('status', 'active')
        .maybeSingle()
      if (!member) {
        return NextResponse.json({ error: 'Assignee is not a member of this workspace' }, { status: 400 })
      }
      update.assigned_agent_id = agentId
    } else {
      return NextResponse.json({ error: 'assigned_agent_id must be a user id or null' }, { status: 400 })
    }
  }

  if ('team_id' in body) {
    const teamId = body.team_id
    if (teamId === null) update.team_id = null
    else if (typeof teamId === 'string' && isUuid(teamId) && (await teamOf(workspace.id, teamId))) update.team_id = teamId
    else return NextResponse.json({ error: 'team_id must be a team of this workspace or null' }, { status: 400 })
  }

  if ('ai_agent_id' in body) {
    const aiAgentId = body.ai_agent_id
    if (aiAgentId === null) {
      update.ai_agent_id = null
    } else if (typeof aiAgentId === 'string' && isUuid(aiAgentId)) {
      const { data: agent } = await supabase
        .from('ai_agents')
        .select('id')
        .eq('workspace_id', workspace.id)
        .eq('id', aiAgentId)
        .eq('enabled', true)
        .maybeSingle()
      if (!agent) {
        return NextResponse.json({ error: 'AI agent not found or disabled in this workspace' }, { status: 400 })
      }
      update.ai_agent_id = aiAgentId
    } else {
      return NextResponse.json({ error: 'ai_agent_id must be an agent id or null' }, { status: 400 })
    }
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }
  update.updated_at = new Date().toISOString()

  const { data, error } = await supabase
    .from('conversations')
    .update(update)
    .eq('id', id)
    .eq('workspace_id', workspace.id)
    .select('*')
    .maybeSingle()

  if (error) {
    console.error('[conversations/patch] update failed:', error.message)
    return NextResponse.json({ error: 'Failed to update conversation' }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })

  // Timeline + notifications (best effort).
  const base = { workspaceId: workspace.id, conversationId: id, fromUser: user.id }
  if ('status' in update && update.status !== current.status) {
    if (update.status === 'closed') await recordEvent({ ...base, type: 'resolved' })
    else if (current.status === 'closed') await recordEvent({ ...base, type: 'reopened' })
  }
  if ('priority' in update && update.priority !== current.priority) {
    await recordEvent({ ...base, type: 'priority', data: { from: current.priority, to: update.priority } })
  }
  if ('assigned_agent_id' in update && update.assigned_agent_id !== current.assigned_agent_id) {
    const to = update.assigned_agent_id as string | null
    if (to) {
      await recordEvent({ ...base, type: 'assigned', toUser: to })
      await markAssigned(workspace.id, to)
      if (to !== user.id) {
        const [names, contact] = await Promise.all([memberNames([user.id]), contactNameOf(id)])
        await notify([
          {
            workspaceId: workspace.id,
            userId: to,
            type: 'assigned',
            title: notificationText(workspace.locale, 'assigned', { actor: names.get(user.id) || notificationText(workspace.locale, 'someone') }),
            body: contact,
            conversationId: id,
            actorId: user.id,
          },
        ])
      }
    } else {
      await recordEvent({ ...base, type: 'unassigned', data: { previous: current.assigned_agent_id } })
    }
  }

  return NextResponse.json({ conversation: data })
}

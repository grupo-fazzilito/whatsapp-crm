import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'
import {
  activeMemberIds,
  contactNameOf,
  markAssigned,
  memberNames,
  notify,
  pickAssignee,
  recordEvent,
  teamOf,
} from '@/lib/inbox/server'
import { notificationText } from '@/lib/inbox/texts'

/**
 * POST /api/conversations/[id]/transfer
 * Body: { to_user_id?: string, team_id?: string, reason?: string }
 *   to_user_id         → assign to that member (and set the team when given)
 *   team_id only       → round-robin among the team's available members;
 *                        when nobody is available the conversation goes to
 *                        the team unassigned and every team member is told.
 * Records a 'transferred' event and notifies the receiver(s).
 * Returns { conversation, assigned_to }.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { supabase, user, workspace } = guard.ctx

  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid conversation id' }, { status: 400 })
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })

  const toUserRaw = body.to_user_id ?? null
  const teamIdRaw = body.team_id ?? null
  if (toUserRaw !== null && (typeof toUserRaw !== 'string' || !isUuid(toUserRaw))) {
    return NextResponse.json({ error: 'to_user_id must be a user id' }, { status: 400 })
  }
  if (teamIdRaw !== null && (typeof teamIdRaw !== 'string' || !isUuid(teamIdRaw))) {
    return NextResponse.json({ error: 'team_id must be a team id' }, { status: 400 })
  }
  if (!toUserRaw && !teamIdRaw) {
    return NextResponse.json({ error: 'to_user_id or team_id is required' }, { status: 400 })
  }
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : ''

  const { data: current } = await supabase
    .from('conversations')
    .select('id, assigned_agent_id, team_id')
    .eq('id', id)
    .eq('workspace_id', workspace.id)
    .maybeSingle()
  if (!current) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })

  const team = teamIdRaw ? await teamOf(workspace.id, teamIdRaw as string) : null
  if (teamIdRaw && !team) return NextResponse.json({ error: 'Team not found' }, { status: 400 })

  let toUser: string | null = null
  if (toUserRaw) {
    const [ok] = await activeMemberIds(workspace.id, [toUserRaw as string])
    if (!ok) return NextResponse.json({ error: 'Receiver is not a member of this workspace' }, { status: 400 })
    toUser = ok
  } else if (team) {
    toUser = await pickAssignee(workspace.id, team.id, [user.id])
  }

  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from('conversations')
    .update({
      assigned_agent_id: toUser,
      ...(team ? { team_id: team.id } : {}),
      // A transferred conversation is active again.
      status: 'open',
      resolved_at: null,
      resolved_by: null,
      updated_at: now,
    })
    .eq('id', id)
    .eq('workspace_id', workspace.id)
    .select('*')
    .maybeSingle()
  if (error || !data) {
    console.error('[conversations/transfer] update failed:', error?.message)
    return NextResponse.json({ error: 'Failed to transfer conversation' }, { status: 500 })
  }

  if (toUser) await markAssigned(workspace.id, toUser)
  await recordEvent({
    workspaceId: workspace.id,
    conversationId: id,
    type: 'transferred',
    fromUser: user.id,
    toUser,
    teamId: team?.id ?? null,
    note: reason || null,
    data: { previous: current.assigned_agent_id ?? null, ...(team && !toUserRaw ? { round_robin: true } : {}) },
  })

  const [names, contact] = await Promise.all([memberNames([user.id]), contactNameOf(id)])
  const actor = names.get(user.id) || notificationText(workspace.locale, 'someone')
  const bodyText = [contact, reason].filter(Boolean).join(' — ')
  if (toUser) {
    await notify([
      {
        workspaceId: workspace.id,
        userId: toUser,
        type: 'transferred',
        title: notificationText(workspace.locale, 'transferred', { actor }),
        body: bodyText,
        conversationId: id,
        actorId: user.id,
      },
    ])
  } else if (team) {
    const receivers = await activeMemberIds(workspace.id, team.memberIds)
    await notify(
      receivers.map((uid) => ({
        workspaceId: workspace.id,
        userId: uid,
        type: 'transferred' as const,
        title: notificationText(workspace.locale, 'teamTransferred', { actor, team: team.name }),
        body: bodyText,
        conversationId: id,
        actorId: user.id,
      })),
    )
  }

  return NextResponse.json({ conversation: data, assigned_to: toUser })
}

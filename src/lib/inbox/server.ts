import 'server-only'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { parseInboxSettings, pickRoundRobin, type AssignCandidate } from './assignment'
import { notificationText, snippet } from './texts'
import type { ConversationEventType, NotificationType } from './types'

// Server-side inbox helpers (service role — every query carries an
// explicit workspace filter).

export interface EventInput {
  workspaceId: string
  conversationId: string
  type: ConversationEventType
  fromUser?: string | null
  toUser?: string | null
  teamId?: string | null
  note?: string | null
  data?: Record<string, unknown>
}

/** Timeline row; never throws (a missing event must not break the action). */
export async function recordEvent(e: EventInput): Promise<void> {
  const { error } = await supabaseAdmin()
    .from('conversation_events')
    .insert({
      workspace_id: e.workspaceId,
      conversation_id: e.conversationId,
      type: e.type,
      from_user: e.fromUser ?? null,
      to_user: e.toUser ?? null,
      team_id: e.teamId ?? null,
      note: e.note ? e.note.slice(0, 500) : null,
      data: e.data ?? {},
    })
  if (error) console.error('[inbox] event insert failed:', error.message)
}

export interface NotifyInput {
  workspaceId: string
  userId: string
  type: NotificationType
  title: string
  body?: string | null
  conversationId?: string | null
  actorId?: string | null
}

export function conversationLink(conversationId: string): string {
  return `/inbox?c=${conversationId}`
}

/** Inserts notifications, skipping the actor themself. Never throws. */
export async function notify(rows: NotifyInput[]): Promise<void> {
  const list = rows.filter((r) => r.userId && r.userId !== r.actorId)
  if (!list.length) return
  const { error } = await supabaseAdmin()
    .from('notifications')
    .insert(
      list.map((r) => ({
        workspace_id: r.workspaceId,
        user_id: r.userId,
        type: r.type,
        title: r.title.slice(0, 200),
        body: r.body ? snippet(r.body, 280) : null,
        link: r.conversationId ? conversationLink(r.conversationId) : null,
        conversation_id: r.conversationId ?? null,
        actor_id: r.actorId ?? null,
      })),
    )
  if (error) console.error('[inbox] notification insert failed:', error.message)
}

/** Display names (profiles.full_name, else email) by user id. */
export async function memberNames(userIds: (string | null | undefined)[]): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter((x): x is string => !!x))]
  const map = new Map<string, string>()
  if (!ids.length) return map
  const { data } = await supabaseAdmin().from('profiles').select('user_id, full_name, email').in('user_id', ids)
  for (const p of data ?? []) {
    map.set(p.user_id as string, ((p.full_name as string) || (p.email as string) || '').trim())
  }
  return map
}

/** Active member user ids of the workspace among `userIds`. */
export async function activeMemberIds(workspaceId: string, userIds: string[]): Promise<string[]> {
  if (!userIds.length) return []
  const { data } = await supabaseAdmin()
    .from('workspace_members')
    .select('user_id')
    .eq('workspace_id', workspaceId)
    .eq('status', 'active')
    .in('user_id', userIds)
  return (data ?? []).map((m) => m.user_id as string)
}

export async function teamOf(workspaceId: string, teamId: string): Promise<{ id: string; name: string; memberIds: string[] } | null> {
  const db = supabaseAdmin()
  const { data: team } = await db.from('teams').select('id, name').eq('workspace_id', workspaceId).eq('id', teamId).maybeSingle()
  if (!team) return null
  const { data: members } = await db.from('team_members').select('user_id').eq('workspace_id', workspaceId).eq('team_id', teamId)
  return { id: team.id as string, name: team.name as string, memberIds: (members ?? []).map((m) => m.user_id as string) }
}

/**
 * Round-robin candidate among available active members — of `teamId`
 * when given, else of the whole workspace.
 */
export async function pickAssignee(workspaceId: string, teamId: string | null, exclude: string[] = []): Promise<string | null> {
  const db = supabaseAdmin()
  let q = db
    .from('workspace_members')
    .select('user_id, available, last_assigned_at')
    .eq('workspace_id', workspaceId)
    .eq('status', 'active')
  if (teamId) {
    const team = await teamOf(workspaceId, teamId)
    if (!team || !team.memberIds.length) return null
    q = q.in('user_id', team.memberIds)
  }
  const { data } = await q
  return pickRoundRobin((data ?? []) as AssignCandidate[], exclude)
}

export async function markAssigned(workspaceId: string, userId: string): Promise<void> {
  await supabaseAdmin()
    .from('workspace_members')
    .update({ last_assigned_at: new Date().toISOString() })
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
}

export async function workspaceLocale(workspaceId: string): Promise<string> {
  const { data } = await supabaseAdmin().from('workspaces').select('locale').eq('id', workspaceId).maybeSingle()
  return (data?.locale as string) ?? 'es'
}

export async function contactNameOf(conversationId: string): Promise<string | null> {
  const { data } = await supabaseAdmin()
    .from('conversations')
    .select('contact:contacts(name, phone)')
    .eq('id', conversationId)
    .maybeSingle()
  const c = data?.contact as unknown as { name?: string | null; phone?: string | null } | null
  return c?.name || c?.phone || null
}

/**
 * Auto-assignment (workspaces.settings.inbox.auto_assign = 'round_robin'):
 * gives an unassigned conversation to the next available member of the
 * conversation's team, else the default team, else everyone. Records an
 * 'assigned' event and notifies the member. Returns the assignee, or
 * null when nothing was done. Never throws.
 */
export async function autoAssignConversation(
  workspaceId: string,
  conversationId: string,
  trigger: 'new_conversation' | 'ai_handover',
): Promise<string | null> {
  try {
    const db = supabaseAdmin()
    const [{ data: ws }, { data: conv }] = await Promise.all([
      db.from('workspaces').select('settings, locale').eq('id', workspaceId).maybeSingle(),
      db
        .from('conversations')
        .select('id, assigned_agent_id, team_id')
        .eq('id', conversationId)
        .eq('workspace_id', workspaceId)
        .maybeSingle(),
    ])
    if (!ws || !conv || conv.assigned_agent_id) return null
    const settings = parseInboxSettings(ws.settings)
    if (settings.auto_assign !== 'round_robin') return null

    let teamId = (conv.team_id as string | null) ?? settings.default_team_id
    if (teamId && !(await teamOf(workspaceId, teamId))) teamId = null
    const pick = await pickAssignee(workspaceId, teamId)
    if (!pick) {
      if (teamId && !conv.team_id) {
        await db.from('conversations').update({ team_id: teamId }).eq('id', conversationId).eq('workspace_id', workspaceId)
      }
      return null
    }

    // Conditional update: a human may have claimed it meanwhile.
    const { data: updated } = await db
      .from('conversations')
      .update({ assigned_agent_id: pick, ...(teamId ? { team_id: teamId } : {}), updated_at: new Date().toISOString() })
      .eq('id', conversationId)
      .eq('workspace_id', workspaceId)
      .is('assigned_agent_id', null)
      .select('id')
      .maybeSingle()
    if (!updated) return null

    await markAssigned(workspaceId, pick)
    await recordEvent({
      workspaceId,
      conversationId,
      type: 'assigned',
      toUser: pick,
      teamId,
      data: { auto: true, trigger },
    })
    const contact = await contactNameOf(conversationId)
    await notify([
      {
        workspaceId,
        userId: pick,
        type: 'assigned',
        title: notificationText(ws.locale as string, 'autoAssigned'),
        body: contact ?? notificationText(ws.locale as string, 'customer'),
        conversationId,
      },
    ])
    return pick
  } catch (err) {
    console.error('[inbox] auto-assign failed:', err instanceof Error ? err.message : err)
    return null
  }
}

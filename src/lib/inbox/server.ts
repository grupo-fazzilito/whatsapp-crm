import 'server-only'
import { prisma } from '@/lib/db/prisma'
import { tenantDb } from '@/lib/db/tenant'
import { parseInboxSettings, pickRoundRobin, type AssignCandidate } from './assignment'
import { notificationText, snippet } from './texts'
import type { ConversationEventType, NotificationType } from './types'

// Server-side inbox helpers (tenant client per workspace; profiles via the
// platform client).

/** Read that yields `fallback` on a database error (supabase-js returned data: null). */
async function quiet<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p
  } catch {
    return fallback
  }
}

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
  try {
    await tenantDb(e.workspaceId).conversation_events.create({
      data: {
      workspace_id: e.workspaceId,
      conversation_id: e.conversationId,
      type: e.type,
      from_user: e.fromUser ?? null,
      to_user: e.toUser ?? null,
      team_id: e.teamId ?? null,
      note: e.note ? e.note.slice(0, 500) : null,
      data: (e.data ?? {}) as object,
      },
    })
  } catch (error) {
    console.error('[inbox] event insert failed:', error instanceof Error ? error.message : error)
  }
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
  // Rows may span workspaces in theory; group by workspace for the tenant client.
  const byWs = new Map<string, NotifyInput[]>()
  for (const r of list) byWs.set(r.workspaceId, [...(byWs.get(r.workspaceId) ?? []), r])
  try {
    for (const [ws, rowsOfWs] of byWs) {
      await tenantDb(ws).notifications.createMany({
        data: rowsOfWs.map((r) => ({
        workspace_id: r.workspaceId,
        user_id: r.userId,
        type: r.type,
        title: r.title.slice(0, 200),
        body: r.body ? snippet(r.body, 280) : null,
        link: r.conversationId ? conversationLink(r.conversationId) : null,
        conversation_id: r.conversationId ?? null,
        actor_id: r.actorId ?? null,
        })),
      })
    }
  } catch (error) {
    console.error('[inbox] notification insert failed:', error instanceof Error ? error.message : error)
  }
}

/** Display names (profiles.full_name, else email) by user id. */
export async function memberNames(userIds: (string | null | undefined)[]): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter((x): x is string => !!x))]
  const map = new Map<string, string>()
  if (!ids.length) return map
  const data = await quiet(
    prisma.profiles.findMany({ where: { user_id: { in: ids } }, select: { user_id: true, full_name: true, email: true } }),
    [],
  )
  for (const p of data) {
    map.set(p.user_id as string, ((p.full_name as string) || (p.email as string) || '').trim())
  }
  return map
}

/** Active member user ids of the workspace among `userIds`. */
export async function activeMemberIds(workspaceId: string, userIds: string[]): Promise<string[]> {
  if (!userIds.length) return []
  const data = await quiet(
    tenantDb(workspaceId).workspace_members.findMany({
      where: { status: 'active', user_id: { in: userIds } },
      select: { user_id: true },
    }),
    [],
  )
  return data.map((m) => m.user_id)
}

export async function teamOf(workspaceId: string, teamId: string): Promise<{ id: string; name: string; memberIds: string[] } | null> {
  const db = tenantDb(workspaceId)
  const team = await quiet(db.teams.findFirst({ where: { id: teamId }, select: { id: true, name: true } }), null)
  if (!team) return null
  const members = await quiet(db.team_members.findMany({ where: { team_id: teamId }, select: { user_id: true } }), [])
  return { id: team.id, name: team.name, memberIds: members.map((m) => m.user_id) }
}

/**
 * Round-robin candidate among available active members — of `teamId`
 * when given, else of the whole workspace.
 */
export async function pickAssignee(workspaceId: string, teamId: string | null, exclude: string[] = []): Promise<string | null> {
  let memberIds: string[] | null = null
  if (teamId) {
    const team = await teamOf(workspaceId, teamId)
    if (!team || !team.memberIds.length) return null
    memberIds = team.memberIds
  }
  const data = await quiet(
    tenantDb(workspaceId).workspace_members.findMany({
      where: { status: 'active', ...(memberIds ? { user_id: { in: memberIds } } : {}) },
      select: { user_id: true, available: true, last_assigned_at: true },
    }),
    [],
  )
  return pickRoundRobin(data as unknown as AssignCandidate[], exclude)
}

export async function markAssigned(workspaceId: string, userId: string): Promise<void> {
  try {
    await tenantDb(workspaceId).workspace_members.updateMany({ where: { user_id: userId }, data: { last_assigned_at: new Date().toISOString() } })
  } catch {
    // Best effort, as before (the error was ignored).
  }
}

export async function workspaceLocale(workspaceId: string): Promise<string> {
  const data = await quiet(tenantDb(workspaceId).workspaces.findFirst({ where: { id: workspaceId }, select: { locale: true } }), null)
  return data?.locale ?? 'es'
}

export async function contactNameOf(conversationId: string): Promise<string | null> {
  // Lookup by conversation id only (callers pass ids they already resolved in their workspace).
  const data = await quiet(
    prisma.conversations.findUnique({
      where: { id: conversationId },
      select: { contacts: { select: { name: true, phone: true } } },
    }),
    null,
  )
  const c = data?.contacts ?? null
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
    const db = tenantDb(workspaceId)
    const [ws, conv] = await Promise.all([
      db.workspaces.findFirst({ where: { id: workspaceId }, select: { settings: true, locale: true } }),
      db.conversations.findFirst({ where: { id: conversationId }, select: { id: true, assigned_agent_id: true, team_id: true } }),
    ])
    if (!ws || !conv || conv.assigned_agent_id) return null
    const settings = parseInboxSettings(ws.settings)
    if (settings.auto_assign !== 'round_robin') return null

    let teamId = conv.team_id ?? settings.default_team_id
    if (teamId && !(await teamOf(workspaceId, teamId))) teamId = null
    const pick = await pickAssignee(workspaceId, teamId)
    if (!pick) {
      if (teamId && !conv.team_id) {
        await db.conversations.updateMany({ where: { id: conversationId }, data: { team_id: teamId } })
      }
      return null
    }

    // Conditional update: a human may have claimed it meanwhile.
    const updated = await db.conversations.updateMany({
      where: { id: conversationId, assigned_agent_id: null },
      data: { assigned_agent_id: pick, ...(teamId ? { team_id: teamId } : {}), updated_at: new Date().toISOString() },
    })
    if (!updated.count) return null

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
        title: notificationText(ws.locale, 'autoAssigned'),
        body: contact ?? notificationText(ws.locale, 'customer'),
        conversationId,
      },
    ])
    return pick
  } catch (err) {
    console.error('[inbox] auto-assign failed:', err instanceof Error ? err.message : err)
    return null
  }
}

// ---------------------------------------------------------------- AI → human

export interface HandoverTarget {
  /** auto = round-robin (when the workspace enabled it); member / team = the AI agent's choice. */
  handover_mode?: string | null
  handover_user_id?: string | null
  handover_team_id?: string | null
}

export interface HandoverInput {
  workspaceId: string
  conversationId: string
  reason: string
  /** Someone chosen explicitly (welcome-menu option); wins over the agent's setting. */
  assigneeUserId?: string | null
  target?: HandoverTarget | null
}

/**
 * The AI passes the conversation to a person: marks it as waiting for a
 * human, assigns it (explicit person → current assignee → the agent's
 * member / team → round-robin), logs it in the timeline and notifies
 * whoever has to answer — the assignee, or else the available members of
 * the team / workspace (everyone active when nobody is available).
 * Returns the assignee. Never throws.
 */
export async function handOverConversation(input: HandoverInput): Promise<string | null> {
  const { workspaceId, conversationId } = input
  try {
    const db = tenantDb(workspaceId)
    const [ws, conv] = await Promise.all([
      db.workspaces.findFirst({ where: { id: workspaceId }, select: { settings: true, locale: true } }),
      db.conversations.findFirst({ where: { id: conversationId }, select: { assigned_agent_id: true, team_id: true } }),
    ])
    if (!conv) return null
    const target = input.target ?? {}
    const settings = parseInboxSettings(ws?.settings)

    let assignee: string | null = null
    let teamId: string | null = conv.team_id ?? null
    let assignedNow = false

    if (input.assigneeUserId && (await activeMemberIds(workspaceId, [input.assigneeUserId])).length) {
      assignee = input.assigneeUserId
      assignedNow = assignee !== conv.assigned_agent_id
    } else if (conv.assigned_agent_id) {
      assignee = conv.assigned_agent_id
    } else if (target.handover_mode === 'member' && target.handover_user_id && (await activeMemberIds(workspaceId, [target.handover_user_id])).length) {
      assignee = target.handover_user_id
      assignedNow = true
    } else {
      if (target.handover_mode === 'team' && target.handover_team_id && (await teamOf(workspaceId, target.handover_team_id))) {
        teamId = target.handover_team_id
      } else if (!teamId && settings.default_team_id && (await teamOf(workspaceId, settings.default_team_id))) {
        teamId = settings.default_team_id
      }
      // A team was chosen for the AI, or the workspace hands out conversations.
      if (target.handover_mode === 'team' || settings.auto_assign === 'round_robin') {
        assignee = await pickAssignee(workspaceId, teamId)
        assignedNow = !!assignee
      }
    }

    const now = new Date()
    if (assignedNow && assignee) {
      // Conditional: a person may have claimed it meanwhile.
      const won = await db.conversations.updateMany({
        where: { id: conversationId, assigned_agent_id: conv.assigned_agent_id ?? null },
        data: { assigned_agent_id: assignee },
      })
      if (won.count) await markAssigned(workspaceId, assignee)
      else assignee = (await db.conversations.findFirst({ where: { id: conversationId }, select: { assigned_agent_id: true } }))?.assigned_agent_id ?? null
    }
    await db.conversations.updateMany({
      where: { id: conversationId },
      data: { ...(teamId !== conv.team_id ? { team_id: teamId } : {}), updated_at: now.toISOString() },
    })
    await db.conversations.updateMany({ where: { id: conversationId, needs_human_since: null }, data: { needs_human_since: now } })

    await recordEvent({
      workspaceId,
      conversationId,
      type: 'ai_handover',
      toUser: assignee,
      teamId,
      note: input.reason,
      data: { auto_assigned: assignedNow },
    })

    const contact = (await contactNameOf(conversationId)) ?? notificationText(ws?.locale, 'customer')
    const body = `${contact} · ${input.reason}`
    if (assignee) {
      await notify([{ workspaceId, userId: assignee, type: 'handover', title: notificationText(ws?.locale, 'handoverToYou'), body, conversationId }])
    } else {
      const recipients = await attentionRecipients(workspaceId, teamId)
      await notify(recipients.map((userId) => ({ workspaceId, userId, type: 'handover' as const, title: notificationText(ws?.locale, 'handoverTeam'), body, conversationId })))
    }
    return assignee
  } catch (err) {
    console.error('[inbox] handover failed:', err instanceof Error ? err.message : err)
    return null
  }
}

/** Available active members of the team (or workspace); everyone active when nobody is available. */
async function attentionRecipients(workspaceId: string, teamId: string | null): Promise<string[]> {
  const team = teamId ? await teamOf(workspaceId, teamId) : null
  const members = await quiet(
    tenantDb(workspaceId).workspace_members.findMany({
      where: { status: 'active', ...(team?.memberIds.length ? { user_id: { in: team.memberIds } } : {}) },
      select: { user_id: true, available: true },
    }),
    [],
  )
  const available = members.filter((m) => m.available !== false).map((m) => m.user_id)
  return available.length ? available : members.map((m) => m.user_id)
}

import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/db/prisma'
import { tenantDb } from '@/lib/db/tenant'
import type { Automation } from '@/types'
import type { ChannelType } from '@/lib/channels/types'
import {
  channelMatches,
  handlerMatches,
  isAiHandled,
  normalizeNoReplyConfig,
  outboundArmsFollowups,
  scheduleRow,
  windowState,
  type WindowState,
} from './followup-rules'

// ------------------------------------------------------------
// "Seguimientos": runtime side of the no_reply trigger.
//   armFollowupsForOutbound  — called by sendMessage after every send
//   cancelFollowupsForInbound — called by ingestMessage for customer messages
//   processDueFollowups      — called by the automations cron
// See supabase/migrations/029_followups.sql for the table.
// ------------------------------------------------------------

export interface OutboundEvent {
  workspaceId: string
  conversationId: string
  contactId: string | null
  channelId: string | null
  messageId: string
  status: string
  metadata?: Record<string, unknown> | null
  now?: Date
}

/** (Re)arms one pending schedule per active no_reply automation. Returns how many. */
export async function armFollowupsForOutbound(ev: OutboundEvent): Promise<number> {
  if (!outboundArmsFollowups({ status: ev.status, metadata: ev.metadata })) return 0
  const db = tenantDb(ev.workspaceId)
  let automations: { id: string; trigger_config: unknown }[]
  try {
    automations = await db.automations.findMany({
      select: { id: true, trigger_config: true },
      where: { workspace_id: ev.workspaceId, trigger_type: 'no_reply', is_active: true },
    })
  } catch (error) {
    throw new Error(`no_reply automations lookup failed: ${errMessage(error)}`)
  }
  if (!automations.length) return 0

  const now = ev.now ?? new Date()
  const rows = automations
    .map((a) => ({ id: a.id as string, cfg: normalizeNoReplyConfig(a.trigger_config) }))
    .filter(({ cfg }) => cfg.after.amount > 0 && channelMatches(cfg, ev.channelId))
    .map(({ id, cfg }) =>
      scheduleRow({
        workspaceId: ev.workspaceId,
        automationId: id,
        conversationId: ev.conversationId,
        contactId: ev.contactId,
        anchorMessageId: ev.messageId,
        after: cfg.after,
        now,
      }),
    )
  if (!rows.length) return 0
  // One atomic INSERT … ON CONFLICT (what PostgREST's upsert did); re-arming
  // replaces the schedule of the same automation + conversation.
  try {
    await prisma.$executeRaw`
      INSERT INTO public.followup_schedules
        (workspace_id, automation_id, conversation_id, contact_id, anchor_message_id, anchored_at, due_at, status, fired_at, cancelled_at)
      VALUES ${Prisma.join(
        rows.map(
          (r) => Prisma.sql`(${r.workspace_id}::uuid, ${r.automation_id}::uuid, ${r.conversation_id}::uuid, ${r.contact_id}::uuid,
            ${r.anchor_message_id}::uuid, ${r.anchored_at}::timestamptz, ${r.due_at}::timestamptz, ${r.status}, NULL, NULL)`,
        ),
      )}
      ON CONFLICT (automation_id, conversation_id) DO UPDATE SET
        workspace_id = EXCLUDED.workspace_id,
        contact_id = EXCLUDED.contact_id,
        anchor_message_id = EXCLUDED.anchor_message_id,
        anchored_at = EXCLUDED.anchored_at,
        due_at = EXCLUDED.due_at,
        status = EXCLUDED.status,
        fired_at = EXCLUDED.fired_at,
        cancelled_at = EXCLUDED.cancelled_at
      WHERE followup_schedules.workspace_id = EXCLUDED.workspace_id`
  } catch (upErr) {
    throw new Error(`followup schedule upsert failed: ${errMessage(upErr)}`)
  }
  return rows.length
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * The customer wrote: cancel every pending follow-up of the conversation
 * and every parked wait of follow-up runs already in progress.
 */
export async function cancelFollowupsForInbound(workspaceId: string, conversationId: string): Promise<void> {
  const db = tenantDb(workspaceId)
  const now = new Date().toISOString()
  try {
    await Promise.all([
      db.followup_schedules.updateMany({
        where: { workspace_id: workspaceId, conversation_id: conversationId, status: 'pending' },
        data: { status: 'cancelled', cancelled_at: now },
      }),
      db.automation_pending_executions.updateMany({
        where: {
          workspace_id: workspaceId,
          status: 'pending',
          // context->>'conversation_id' = conversationId AND context->>'followup' = 'true'
          AND: [
            { context: { path: ['conversation_id'], equals: conversationId } },
            { OR: [{ context: { path: ['followup'], equals: true } }, { context: { path: ['followup'], equals: 'true' } }] },
          ],
        },
        data: { status: 'cancelled' },
      }),
    ])
  } catch (err) {
    throw new Error(`followup cancel failed: ${errMessage(err)}`)
  }
}

// ------------------------------------------------------------
// Conversation info used by the cron and by the engine's send steps
// ------------------------------------------------------------

export interface ConversationInfo {
  id: string
  contactId: string
  status: string | null
  channelId: string | null
  channelType: ChannelType
  channelAgentId: string | null
  conversationAgentId: string | null
  aiPausedUntil: string | null
}

export async function loadConversationInfo(workspaceId: string, conversationId: string): Promise<ConversationInfo | null> {
  const db = tenantDb(workspaceId)
  const conv = await db.conversations.findFirst({
    select: { id: true, contact_id: true, status: true, channel_id: true, ai_agent_id: true, ai_paused_until: true },
    where: { id: conversationId, workspace_id: workspaceId },
  }).catch(() => null)
  if (!conv) return null
  let channelType: ChannelType = 'whatsapp'
  let channelAgentId: string | null = null
  if (conv.channel_id) {
    const ch = await db.channels.findFirst({
      select: { type: true, ai_agent_id: true },
      where: { id: conv.channel_id, workspace_id: workspaceId },
    }).catch(() => null)
    if (ch) {
      channelType = ch.type as ChannelType
      channelAgentId = ch.ai_agent_id ?? null
    }
  }
  return {
    id: conv.id,
    contactId: conv.contact_id,
    status: conv.status ?? null,
    channelId: conv.channel_id ?? null,
    channelType,
    channelAgentId,
    conversationAgentId: conv.ai_agent_id ?? null,
    aiPausedUntil: conv.ai_paused_until ?? null,
  }
}

async function lastCustomerMessageAt(workspaceId: string, conversationId: string): Promise<string | null> {
  const data = await tenantDb(workspaceId).messages.findFirst({
    select: { created_at: true },
    where: { workspace_id: workspaceId, conversation_id: conversationId, sender_type: 'customer' },
    orderBy: { created_at: 'desc' },
  }).catch(() => null)
  return (data?.created_at as string | undefined) ?? null
}

/** Is a free-form message allowed right now on this conversation? */
export async function conversationWindow(info: ConversationInfo, workspaceId: string): Promise<WindowState> {
  return windowState(info.channelType, await lastCustomerMessageAt(workspaceId, info.id))
}

// ------------------------------------------------------------
// Cron
// ------------------------------------------------------------

interface ScheduleRow {
  id: string
  workspace_id: string
  automation_id: string
  conversation_id: string
  contact_id: string | null
  anchored_at: string
  due_at: string
}

export interface FollowupRunResult {
  fired: number
  skipped: number
}

export async function processDueFollowups(limit = 50, now = new Date()): Promise<FollowupRunResult> {
  // Platform task: drains the due schedules of every workspace.
  const due: ScheduleRow[] = await prisma.followup_schedules.findMany({
    select: { id: true, workspace_id: true, automation_id: true, conversation_id: true, contact_id: true, anchored_at: true, due_at: true },
    where: { status: 'pending', due_at: { lte: now.toISOString() } },
    orderBy: { due_at: 'asc' },
    take: limit,
  })

  const result: FollowupRunResult = { fired: 0, skipped: 0 }
  for (const row of due) {
    // Claim: only if still pending AND not re-armed since we read it.
    let claimed = 0
    try {
      ;({ count: claimed } = await tenantDb(row.workspace_id).followup_schedules.updateMany({
        where: { id: row.id, workspace_id: row.workspace_id, status: 'pending', due_at: row.due_at },
        data: { status: 'fired', fired_at: new Date().toISOString() },
      }))
    } catch (err) {
      console.error('[followups] claim failed:', row.id, err)
    }
    if (!claimed) continue
    try {
      const ran = await fireSchedule(row)
      if (ran) result.fired++
      else result.skipped++
    } catch (err) {
      console.error('[followups] fire failed:', row.id, err)
      result.skipped++
    }
  }
  return result
}

async function fireSchedule(row: ScheduleRow): Promise<boolean> {
  const db = tenantDb(row.workspace_id)
  const skip = async (reason: string) => {
    try {
      await db.followup_schedules.updateMany({
        where: { id: row.id },
        data: { status: 'cancelled', cancelled_at: new Date().toISOString() },
      })
    } catch (err) {
      console.error('[followups] skip update failed:', row.id, err)
    }
    console.info(`[followups] skipped ${row.id}: ${reason}`)
    return false
  }

  const automation = await db.automations.findFirst({
    where: { id: row.automation_id, workspace_id: row.workspace_id },
  }).catch(() => null)
  if (!automation || !automation.is_active || automation.trigger_type !== 'no_reply') return skip('automation inactive')

  const info = await loadConversationInfo(row.workspace_id, row.conversation_id)
  if (!info) return skip('conversation gone')
  if (info.status === 'closed') return skip('conversation closed')

  const cfg = normalizeNoReplyConfig(automation.trigger_config)
  if (!channelMatches(cfg, info.channelId)) return skip('channel filter')
  const aiHandled = isAiHandled({
    conversationAgentId: info.conversationAgentId,
    channelAgentId: info.channelAgentId,
    aiPausedUntil: info.aiPausedUntil,
  })
  if (!handlerMatches(cfg, aiHandled)) return skip(aiHandled ? 'only for human conversations' : 'only for AI conversations')

  // Defensive: the customer replied but the cancel hook missed it.
  const lastIn = await lastCustomerMessageAt(row.workspace_id, row.conversation_id)
  if (lastIn && new Date(lastIn).getTime() > new Date(row.anchored_at).getTime()) return skip('customer replied')

  const contact = await db.contacts.findFirst({
    select: { name: true },
    where: { id: info.contactId, workspace_id: row.workspace_id },
  }).catch(() => null)

  const { runAutomationNow } = await import('./engine')
  await runAutomationNow(automation as unknown as Automation & { workspace_id: string }, {
    workspaceId: row.workspace_id,
    triggerType: 'no_reply',
    contactId: info.contactId,
    context: {
      conversation_id: row.conversation_id,
      followup: true,
      vars: { contact_name: contact?.name ?? '' },
    },
  })
  return true
}

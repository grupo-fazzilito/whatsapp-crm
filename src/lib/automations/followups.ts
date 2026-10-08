import { supabaseAdmin } from './admin-client'
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
  const db = supabaseAdmin()
  const { data: automations, error } = await db
    .from('automations')
    .select('id, trigger_config')
    .eq('workspace_id', ev.workspaceId)
    .eq('trigger_type', 'no_reply')
    .eq('is_active', true)
  if (error) throw new Error(`no_reply automations lookup failed: ${error.message}`)
  if (!automations?.length) return 0

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
  const { error: upErr } = await db
    .from('followup_schedules')
    .upsert(rows, { onConflict: 'automation_id,conversation_id' })
  if (upErr) throw new Error(`followup schedule upsert failed: ${upErr.message}`)
  return rows.length
}

/**
 * The customer wrote: cancel every pending follow-up of the conversation
 * and every parked wait of follow-up runs already in progress.
 */
export async function cancelFollowupsForInbound(workspaceId: string, conversationId: string): Promise<void> {
  const db = supabaseAdmin()
  const now = new Date().toISOString()
  const [{ error: e1 }, { error: e2 }] = await Promise.all([
    db
      .from('followup_schedules')
      .update({ status: 'cancelled', cancelled_at: now })
      .eq('workspace_id', workspaceId)
      .eq('conversation_id', conversationId)
      .eq('status', 'pending'),
    db
      .from('automation_pending_executions')
      .update({ status: 'cancelled' })
      .eq('workspace_id', workspaceId)
      .eq('status', 'pending')
      .eq('context->>conversation_id', conversationId)
      .eq('context->>followup', 'true'),
  ])
  if (e1 || e2) throw new Error(`followup cancel failed: ${(e1 ?? e2)!.message}`)
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
  const db = supabaseAdmin()
  const { data: conv } = await db
    .from('conversations')
    .select('id, contact_id, status, channel_id, ai_agent_id, ai_paused_until')
    .eq('id', conversationId)
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  if (!conv) return null
  let channelType: ChannelType = 'whatsapp'
  let channelAgentId: string | null = null
  if (conv.channel_id) {
    const { data: ch } = await db
      .from('channels')
      .select('type, ai_agent_id')
      .eq('id', conv.channel_id)
      .eq('workspace_id', workspaceId)
      .maybeSingle()
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
  const { data } = await supabaseAdmin()
    .from('messages')
    .select('created_at')
    .eq('workspace_id', workspaceId)
    .eq('conversation_id', conversationId)
    .eq('sender_type', 'customer')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
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
  const db = supabaseAdmin()
  const { data: due, error } = await db
    .from('followup_schedules')
    .select('id, workspace_id, automation_id, conversation_id, contact_id, anchored_at, due_at')
    .eq('status', 'pending')
    .lte('due_at', now.toISOString())
    .order('due_at', { ascending: true })
    .limit(limit)
  if (error) throw new Error(error.message)

  const result: FollowupRunResult = { fired: 0, skipped: 0 }
  for (const row of (due ?? []) as ScheduleRow[]) {
    // Claim: only if still pending AND not re-armed since we read it.
    const { data: claim } = await db
      .from('followup_schedules')
      .update({ status: 'fired', fired_at: new Date().toISOString() })
      .eq('id', row.id)
      .eq('status', 'pending')
      .eq('due_at', row.due_at)
      .select('id')
      .maybeSingle()
    if (!claim) continue
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
  const db = supabaseAdmin()
  const skip = async (reason: string) => {
    await db.from('followup_schedules').update({ status: 'cancelled', cancelled_at: new Date().toISOString() }).eq('id', row.id)
    console.info(`[followups] skipped ${row.id}: ${reason}`)
    return false
  }

  const { data: automation } = await db
    .from('automations')
    .select('*')
    .eq('id', row.automation_id)
    .eq('workspace_id', row.workspace_id)
    .maybeSingle()
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

  const { data: contact } = await db
    .from('contacts')
    .select('name')
    .eq('id', info.contactId)
    .eq('workspace_id', row.workspace_id)
    .maybeSingle()

  const { runAutomationNow } = await import('./engine')
  await runAutomationNow(automation as Automation & { workspace_id: string }, {
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

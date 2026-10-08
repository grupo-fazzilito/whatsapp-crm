import type { DelayUnit, NoReplyTriggerConfig } from '@/types'
import { CHANNEL_CAPABILITIES } from '@/lib/channels/capabilities'
import type { ChannelType } from '@/lib/channels/types'

// ------------------------------------------------------------
// "Seguimientos" (no_reply trigger) — pure rules shared by the
// messaging hooks, the cron, the engine and the builder UI.
// No server imports: this file is bundled into the browser too.
// ------------------------------------------------------------

const UNIT_MS: Record<DelayUnit, number> = {
  minutes: 60_000,
  hours: 3_600_000,
  days: 86_400_000,
}

/** "Último aviso antes de que cierre la ventana" preset. */
export const LAST_CALL_PRESET: NoReplyTriggerConfig['after'] = { amount: 23, unit: 'hours' }

export const DEFAULT_NO_REPLY_CONFIG: NoReplyTriggerConfig = {
  after: { amount: 2, unit: 'hours' },
  channel_ids: [],
}

export function delayMs(after: { amount?: unknown; unit?: unknown } | null | undefined): number {
  const amount = Number(after?.amount)
  const unit = UNIT_MS[after?.unit as DelayUnit] ?? UNIT_MS.hours
  if (!Number.isFinite(amount) || amount <= 0) return 0
  return amount * unit
}

export function delayHours(after: { amount?: unknown; unit?: unknown } | null | undefined): number {
  return delayMs(after) / UNIT_MS.hours
}

/** Coerces whatever is stored in trigger_config into a usable config. */
export function normalizeNoReplyConfig(raw: unknown): NoReplyTriggerConfig {
  const c = (raw ?? {}) as Record<string, unknown>
  const after = (c.after ?? {}) as Record<string, unknown>
  const unit = (['minutes', 'hours', 'days'] as const).includes(after.unit as DelayUnit)
    ? (after.unit as DelayUnit)
    : 'hours'
  const amount = Number(after.amount)
  return {
    after: { amount: Number.isFinite(amount) ? amount : 0, unit },
    channel_ids: Array.isArray(c.channel_ids)
      ? (c.channel_ids as unknown[]).filter((v): v is string => typeof v === 'string' && v.length > 0)
      : [],
    only_when_ai: c.only_when_ai === true,
    only_when_human: c.only_when_human === true,
  }
}

export function channelMatches(cfg: NoReplyTriggerConfig, channelId: string | null | undefined): boolean {
  if (!cfg.channel_ids || cfg.channel_ids.length === 0) return true
  return !!channelId && cfg.channel_ids.includes(channelId)
}

/**
 * A conversation is "handled by AI" when an agent owns it (conversation
 * or channel agent) and no human has paused the AI.
 */
export function isAiHandled(input: {
  conversationAgentId?: string | null
  channelAgentId?: string | null
  aiPausedUntil?: string | null
  now?: Date
}): boolean {
  const now = input.now ?? new Date()
  const paused = !!input.aiPausedUntil && new Date(input.aiPausedUntil).getTime() > now.getTime()
  return !paused && !!(input.conversationAgentId || input.channelAgentId)
}

export function handlerMatches(cfg: NoReplyTriggerConfig, aiHandled: boolean): boolean {
  if (cfg.only_when_ai && !aiHandled) return false
  if (cfg.only_when_human && aiHandled) return false
  return true
}

/**
 * Should an outbound message (re)arm follow-up schedules?
 * - failed sends never count;
 * - follow-ups themselves never re-arm anything (no loops, and a 2 h
 *   follow-up must not push back a 23 h "last call" of another automation);
 * - broadcasts are campaigns, not conversations: they never arm follow-ups.
 */
export function outboundArmsFollowups(input: {
  status: string
  metadata?: Record<string, unknown> | null
}): boolean {
  if (input.status === 'failed') return false
  const m = input.metadata ?? {}
  if (m.followup === true) return false
  if (m.source === 'broadcast') return false
  return true
}

/** Row to upsert for one (automation, conversation) pair. */
export function scheduleRow(input: {
  workspaceId: string
  automationId: string
  conversationId: string
  contactId: string | null
  anchorMessageId: string | null
  after: NoReplyTriggerConfig['after']
  now: Date
}) {
  const ms = Math.max(60_000, delayMs(input.after))
  return {
    workspace_id: input.workspaceId,
    automation_id: input.automationId,
    conversation_id: input.conversationId,
    contact_id: input.contactId,
    anchor_message_id: input.anchorMessageId,
    anchored_at: input.now.toISOString(),
    due_at: new Date(input.now.getTime() + ms).toISOString(),
    status: 'pending' as const,
    fired_at: null,
    cancelled_at: null,
  }
}

// ------------------------------------------------------------
// Messaging window (WhatsApp / Instagram / Messenger: 24 h after the
// customer's last message; TikTok 48 h; web chat: none)
// ------------------------------------------------------------

export interface WindowState {
  open: boolean
  /** Window length for the channel; null = no window. */
  hours: number | null
}

export function windowState(
  channelType: ChannelType | null | undefined,
  lastCustomerMessageAt: string | null | undefined,
  now: Date = new Date(),
): WindowState {
  const hours = CHANNEL_CAPABILITIES[channelType ?? 'whatsapp']?.replyWindowHours ?? null
  if (hours === null) return { open: true, hours: null }
  if (!lastCustomerMessageAt) return { open: false, hours }
  const last = new Date(lastCustomerMessageAt).getTime()
  if (Number.isNaN(last)) return { open: false, hours }
  return { open: now.getTime() - last < hours * UNIT_MS.hours, hours }
}

export function windowClosedMessage(hours: number | null): string {
  return `Ventana de ${hours ?? 24} h cerrada: usa una plantilla`
}

/** Channels where approved templates can be sent. */
export function supportsTemplates(channelType: ChannelType | null | undefined): boolean {
  return !!CHANNEL_CAPABILITIES[channelType ?? 'whatsapp']?.templates
}

import 'server-only'
import { tenantDb } from '@/lib/db/tenant'
import { isPrismaError } from '@/lib/db/errors'
import type { LoadedChannel } from '@/lib/channels'
import { findOrCreateContact, findOrCreateConversation } from '@/lib/messaging/ingest'
import { fillReply, pickPublicReply, pickRule, type CommentEvent } from './model'
import { GraphError, replyToComment, sendPrivateReply } from './meta'
import { TiktokError, replyToTiktokComment } from '@/lib/tiktok/api'
import { TIKTOK_REPLY_MAX } from '@/lib/tiktok/model'
import { canSpend, spend } from '@/lib/billing/credits'

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

export type CommentOutcome = 'no_rule' | 'duplicate' | 'skipped' | 'no_tokens' | 'replied' | 'partial' | 'failed'

/**
 * Answers one new comment with the first rule that matches it: a public
 * reply under the comment and/or a private message to its author, which
 * opens (or continues) their conversation in the inbox. Each comment is
 * handled once, and each person is answered once per post. Every answered
 * comment costs tokens ('comment_reply'); with none left it is only logged.
 */
export async function handleComment(channel: LoadedChannel, ev: CommentEvent): Promise<CommentOutcome> {
  const db = tenantDb(channel.workspace_id)
  // The account itself may comment on its posts and be answered (handy to try a rule), but its
  // replies under a comment are our own public answers: answering them would loop.
  const own = ev.from.id === channel.external_id || ev.from.id === channel.settings.page_id
  if (own && ev.parentId) return 'no_rule'
  if (own && (await db.comment_replies.findFirst({ where: { channel_id: channel.id, public_reply_id: ev.commentId }, select: { id: true } }))) return 'no_rule'

  const rules = await db.comment_rules.findMany({
    // A detached rule (its account was deleted) has no channel but isn't "every account".
    where: { enabled: true, detached_external_id: null, OR: [{ channel_id: null }, { channel_id: channel.id }] },
    select: { id: true, channel_id: true, post_id: true, keywords: true, enabled: true, position: true, public_replies: true, private_message: true },
  })
  const rule = pickRule(rules, { channelId: channel.id, postId: ev.postId, text: ev.text })
  if (!rule) return 'no_rule'
  // TikTok has no private message from a comment: a rule with only a private message doesn't apply there.
  const tiktok = channel.type === 'tiktok'
  if (tiktok && !rule.public_replies.some((r) => r.trim())) return 'no_rule'

  const answeredBefore = ev.postId
    ? await db.comment_replies.findFirst({
        where: { channel_id: channel.id, post_id: ev.postId, author_id: ev.from.id, status: { in: ['replied', 'partial'] } },
        select: { id: true },
      })
    : null
  const hasTokens = answeredBefore ? true : await canSpend(channel.workspace_id, 'comment_reply')

  // Claim the comment first: Meta retries webhooks, and a retry must not reply twice.
  let row: { id: string }
  try {
    row = await db.comment_replies.create({
      data: {
        workspace_id: channel.workspace_id,
        channel_id: channel.id,
        rule_id: rule.id,
        comment_id: ev.commentId,
        post_id: ev.postId,
        author_id: ev.from.id,
        author_name: ev.from.name,
        comment_text: ev.text.slice(0, 2000),
        status: answeredBefore ? 'skipped' : hasTokens ? 'failed' : 'no_tokens',
      },
      select: { id: true },
    })
  } catch (err) {
    if (isPrismaError(err, 'P2002')) return 'duplicate'
    throw err
  }
  if (answeredBefore) return 'skipped'
  if (!hasTokens) return 'no_tokens'

  const errors: string[] = []
  let publicReplyId: string | null = null
  let privateMessageId: string | null = null
  let conversationId: string | null = null
  const publicText = pickPublicReply(rule.public_replies)
  const privateText = !tiktok && rule.private_message?.trim() ? fillReply(rule.private_message, ev.from.name) : null

  if (publicText) {
    try {
      const text = fillReply(publicText, ev.from.name)
      publicReplyId = tiktok
        ? await replyToTiktokComment(channel, ev.postId ?? '', ev.commentId, text)
        : await replyToComment(channel, ev.commentId, text)
    } catch (err) {
      errors.push(describe('public', err))
    }
  }

  if (privateText) {
    try {
      const sent = await sendPrivateReply(channel, ev.commentId, privateText)
      privateMessageId = sent.messageId
      conversationId = await recordPrivateReply(channel, ev, sent.recipientId ?? ev.from.id, privateText, sent.messageId, rule.id)
    } catch (err) {
      errors.push(describe('private', err))
    }
  }

  const tried = Number(!!publicText) + Number(!!privateText)
  const status: CommentOutcome = errors.length === 0 ? 'replied' : errors.length < tried ? 'partial' : 'failed'
  await db.comment_replies.updateMany({
    where: { id: row.id },
    data: { status, public_reply_id: publicReplyId, private_message_id: privateMessageId, conversation_id: conversationId, error: errors.join(' · ').slice(0, 500) || null },
  })
  if (status !== 'failed') {
    await spend(channel.workspace_id, 'comment_reply', { conversationId })
    await db.comment_rules.updateMany({ where: { id: rule.id }, data: { replies_count: { increment: 1 }, last_triggered_at: new Date() } })
  }
  return status
}

function describe(kind: 'public' | 'private', err: unknown): string {
  const prefix = kind === 'public' ? 'Respuesta pública' : 'Mensaje privado'
  if ((err instanceof GraphError || err instanceof TiktokError) && err.needsReconnect) return `${prefix}: falta permiso (vuelve a conectar la cuenta). ${err.message}`
  return `${prefix}: ${message(err)}`
}

/** The private reply as the first message of the person's conversation. */
async function recordPrivateReply(channel: LoadedChannel, ev: CommentEvent, recipientId: string, text: string, externalId: string | null, ruleId: string): Promise<string | null> {
  const db = tenantDb(channel.workspace_id)
  const contact = await findOrCreateContact(channel, {
    externalId: recipientId,
    name: channel.type === 'messenger' ? ev.from.name : null,
    handle: channel.type === 'instagram' ? ev.from.name : null,
  })
  if (!contact) return null
  const conversation = await findOrCreateConversation(channel, contact.id)
  if (!conversation) return null
  const now = new Date()
  await db.messages.create({
    data: {
      workspace_id: channel.workspace_id,
      conversation_id: conversation.id,
      sender_type: 'bot',
      content_type: 'text',
      content_text: text,
      message_id: externalId,
      status: 'sent',
      metadata: { source: 'comment_reply', rule_id: ruleId, comment_id: ev.commentId, post_id: ev.postId, comment_text: ev.text.slice(0, 500) },
    },
  })
  await db.conversations.updateMany({
    where: { id: conversation.id },
    data: { last_message_text: text, last_message_at: now, updated_at: now },
  })
  return conversation.id
}

export async function handleComments(channel: LoadedChannel, events: CommentEvent[]): Promise<void> {
  for (const ev of events) {
    try {
      await handleComment(channel, ev)
    } catch (err) {
      console.error('[comments] failed to handle comment:', message(err))
    }
  }
}

// ---------------------------------------------------------------- editor

export const COMMENT_CHANNEL_TYPES = ['instagram', 'messenger', 'tiktok'] as const

/** Instagram, Facebook and TikTok accounts of the workspace (the ones rules can apply to). */
export async function commentChannels(workspaceId: string) {
  return tenantDb(workspaceId).channels.findMany({
    where: { type: { in: [...COMMENT_CHANNEL_TYPES] } },
    select: { id: true, type: true, name: true, display_handle: true, status: true },
    orderBy: { created_at: 'asc' },
  })
}

export async function listRules(workspaceId: string) {
  return tenantDb(workspaceId).comment_rules.findMany({ orderBy: [{ position: 'asc' }, { created_at: 'asc' }] })
}

export async function recentReplies(workspaceId: string, take = 50) {
  return tenantDb(workspaceId).comment_replies.findMany({
    orderBy: { created_at: 'desc' },
    take,
    select: {
      id: true, channel_id: true, rule_id: true, post_id: true, author_name: true, comment_text: true, status: true,
      error: true, conversation_id: true, created_at: true, comment_rules: { select: { name: true } },
    },
  })
}

/** The rule's account type (null = every account), or false when it isn't one of this workspace's Instagram / Facebook / TikTok accounts. */
async function ruleChannelType(workspaceId: string, channelId: string | null): Promise<(typeof COMMENT_CHANNEL_TYPES)[number] | null | false> {
  if (!channelId) return null
  const c = await tenantDb(workspaceId).channels.findFirst({ where: { id: channelId, type: { in: [...COMMENT_CHANNEL_TYPES] } }, select: { type: true } })
  return c ? (c.type as (typeof COMMENT_CHANNEL_TYPES)[number]) : false
}

/**
 * Checks a parsed rule against its account. TikTok only allows public replies
 * (up to 1,200 characters), so a TikTok rule needs one and keeps no private message.
 */
export async function fitRuleToChannel<R extends { channel_id: string | null; public_replies: string[]; private_message: string | null }>(
  workspaceId: string,
  rule: R,
): Promise<{ ok: true; rule: R } | { ok: false; error: 'channel' | 'reply_tiktok' | 'too_long_tiktok' }> {
  const type = await ruleChannelType(workspaceId, rule.channel_id)
  if (type === false) return { ok: false, error: 'channel' }
  if (type !== 'tiktok') return { ok: true, rule }
  if (rule.public_replies.length === 0) return { ok: false, error: 'reply_tiktok' }
  if (rule.public_replies.some((r) => r.length > TIKTOK_REPLY_MAX)) return { ok: false, error: 'too_long_tiktok' }
  return { ok: true, rule: { ...rule, private_message: null } }
}

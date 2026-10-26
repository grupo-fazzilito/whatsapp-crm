import 'server-only'
import type { Prisma } from '@/generated/prisma/client'
import { tenantDb } from '@/lib/db/tenant'
import { isPrismaError } from '@/lib/db/errors'
import { phonesMatch } from '@/lib/whatsapp/phone-utils'
import { waMediaProxyUrl } from '@/lib/channels/parsers/whatsapp'
import type { InboundEvent, LoadedChannel } from '@/lib/channels'
import type { AiAgentRow } from '@/lib/ai/types'
import { routeInbound } from '@/lib/ai/routing'
import type { ConversationAiState } from '@/lib/ai/types'
import { dispatchInboundToFlows } from '@/lib/flows/engine'
import { handleBookingPickerInbound } from '@/lib/bookings/picker'
import { isPickerReply } from '@/lib/bookings/picker-model'
import { runAutomationsForTrigger } from '@/lib/automations/engine'
import { cancelFollowupsForInbound } from '@/lib/automations/followups'
import { handleCheckoutText, handleCommerceAction, handlePaymentProof, isCommerceAction, type CommerceCtx } from '@/lib/orders/chat'
import type { Workspace } from '@/lib/workspace/types'
import { autoAssignConversation, recordEvent } from '@/lib/inbox/server'
import { handleVisitAction, isVisitAction } from '@/lib/real-estate/leads/visits'
import { inboundMediaText } from '@/lib/ai/assist/service'

type MessageEvent = Extract<InboundEvent, { kind: 'message' }>

export type { AiAgentRow }

export interface IngestOutcome {
  contactId: string
  conversationId: string
  messageId: string | null
  duplicate: boolean
}

// ------------------------------------------------------------
// Status updates (sent/delivered/read/failed)
// ------------------------------------------------------------
const RECIPIENT_STATUS_LADDER = ['pending', 'sent', 'delivered', 'read', 'replied'] as const

/** Forward-only on the success ladder; `failed` only before delivery. */
export function isValidStatusTransition(current: string, incoming: string): boolean {
  if (incoming === 'failed') return current === 'pending' || current === 'sent'
  if (current === 'failed') return false
  const ci = (RECIPIENT_STATUS_LADDER as readonly string[]).indexOf(current)
  const ii = (RECIPIENT_STATUS_LADDER as readonly string[]).indexOf(incoming)
  if (ii < 0) return false
  if (ci < 0) return true
  return ii > ci
}

const MESSAGE_STATUS_RANK: Record<string, number> = { sending: 0, sent: 1, delivered: 2, read: 3, failed: 4 }

async function applyStatus(channel: LoadedChannel, ev: Extract<InboundEvent, { kind: 'status' }>) {
  const db = tenantDb(channel.workspace_id)
  // maybeSingle(): more than one match counted as none.
  const msgs = await db.messages.findMany({
    where: { message_id: ev.externalMessageId },
    select: { id: true, status: true, metadata: true },
    take: 2,
  })
  const msg = msgs.length === 1 ? msgs[0] : null
  if (msg && (MESSAGE_STATUS_RANK[ev.status] ?? 0) > (MESSAGE_STATUS_RANK[msg.status] ?? 0)) {
    await db.messages
      .updateMany({
        where: { id: msg.id },
        data: {
          status: ev.status,
          ...(ev.error ? { metadata: { ...((msg.metadata as Record<string, unknown> | null) ?? {}), error: ev.error } as Prisma.InputJsonObject } : {}),
        },
      })
      .catch(() => {})
  }

  const recipient = await db.broadcast_recipients.findFirst({
    where: { whatsapp_message_id: ev.externalMessageId },
    select: { id: true, status: true },
  })
  if (!recipient || !isValidStatusTransition(recipient.status, ev.status)) return
  const ts = new Date(ev.timestamp).toISOString()
  await db.broadcast_recipients
    .updateMany({
      where: { id: recipient.id },
      data: {
      status: ev.status,
      ...(ev.status === 'sent' ? { sent_at: ts } : {}),
      ...(ev.status === 'delivered' ? { delivered_at: ts } : {}),
      ...(ev.status === 'read' ? { read_at: ts } : {}),
      ...(ev.status === 'failed' && ev.error ? { error_message: ev.error } : {}),
      },
    })
    .catch(() => {})
}

// ------------------------------------------------------------
// Contacts & conversations
// ------------------------------------------------------------
export async function findOrCreateContact(
  channel: LoadedChannel,
  from: MessageEvent['from'],
): Promise<{ id: string; wasCreated: boolean } | null> {
  const ws = channel.workspace_id
  const db = tenantDb(ws)
  // WhatsApp: the phone and the BSUID are both identities of the person;
  // either one finds them, and the one missing is added.
  const keys = [...new Set([from.externalId, from.userId].filter((k): k is string => !!k))]

  const known = await db.contact_identities.findMany({
    where: { channel_type: channel.type, external_id: { in: keys } },
    select: { contact_id: true, external_id: true },
  })
  // Prefer the phone's contact: it may have a history the BSUID one lacks.
  const identity = known.find((k) => k.external_id === from.externalId) ?? known[0]
  if (identity) {
    await linkIdentities(channel, identity.contact_id, from, keys.filter((k) => !known.some((x) => x.external_id === k)))
    return { id: identity.contact_id, wasCreated: false }
  }

  // WhatsApp: a contact created by hand / CSV import has a phone but no
  // identity yet. Match it (tolerating formatting) before creating one.
  let contactId: string | null = null
  let wasCreated = false
  if (from.phone) {
    const candidates = await db.contacts.findMany({ where: { phone: { not: null } }, select: { id: true, phone: true } })
    contactId = candidates.find((c) => phonesMatch(c.phone ?? '', from.phone!))?.id ?? null
  }

  if (!contactId) {
    const fallbackName =
      from.name || from.handle || from.phone || `${channel.type} ${from.externalId.slice(-4)}`
    try {
      const created = await db.contacts.create({
        data: { workspace_id: ws, name: fallbackName, phone: from.phone ?? null },
        select: { id: true },
      })
      contactId = created.id
    } catch (error) {
      console.error('[ingest] contact insert failed:', error instanceof Error ? error.message : error)
      return null
    }
    wasCreated = true
  }

  try {
    await db.contact_identities.create({
      data: {
        workspace_id: ws,
        contact_id: contactId,
        channel_type: channel.type,
        external_id: from.externalId,
        handle: from.handle ?? from.phone ?? null,
      },
    })
  } catch (idErr) {
    // Other insert errors were ignored before as well.
    if (isPrismaError(idErr, 'P2002')) {
      // Concurrent first message created it a moment ago: use that one.
      const winner = await db.contact_identities
        .findFirst({ where: { channel_type: channel.type, external_id: from.externalId }, select: { contact_id: true } })
        .catch(() => null)
      if (wasCreated && winner && winner.contact_id !== contactId) {
        await db.contacts.deleteMany({ where: { id: contactId } }).catch(() => {})
      }
      return winner ? { id: winner.contact_id, wasCreated: false } : null
    }
  }
  await linkIdentities(channel, contactId!, from, keys.filter((k) => k !== from.externalId))
  return { id: contactId!, wasCreated }
}

/**
 * Adds the identities the contact doesn't have yet (best effort: one that
 * already belongs to someone else is left there), and the phone when we
 * only knew them by BSUID until now.
 */
async function linkIdentities(channel: LoadedChannel, contactId: string, from: MessageEvent['from'], missing: string[]) {
  const db = tenantDb(channel.workspace_id)
  for (const externalId of missing) {
    const isUserId = externalId === from.userId && externalId !== from.phone
    await db.contact_identities
      .create({
        data: {
          workspace_id: channel.workspace_id,
          contact_id: contactId,
          channel_type: channel.type,
          external_id: externalId,
          handle: isUserId ? (from.handle?.startsWith('@') ? from.handle : null) : from.handle ?? from.phone ?? null,
        },
      })
      .catch(() => {})
  }
  if (from.phone) {
    await db.contacts.updateMany({ where: { id: contactId, phone: null }, data: { phone: from.phone } }).catch(() => {})
  }
}

/**
 * WhatsApp system message: the customer changed their number or BSUID.
 * The contact keeps their conversation; the old id is replaced by the new.
 */
async function applyIdentityChange(channel: LoadedChannel, ev: Extract<InboundEvent, { kind: 'identity_change' }>) {
  const db = tenantDb(channel.workspace_id)
  const before = [ev.previous.phone, ev.previous.userId].filter((k): k is string => !!k)
  const identity = await db.contact_identities.findFirst({
    where: { channel_type: channel.type, external_id: { in: before } },
    select: { contact_id: true },
  })
  if (!identity) return
  const contactId = identity.contact_id
  const replaced = [
    ev.current.phone && ev.previous.phone !== ev.current.phone ? ev.previous.phone : null,
    ev.current.userId && ev.previous.userId !== ev.current.userId ? ev.previous.userId : null,
  ].filter((k): k is string => !!k)
  if (replaced.length) {
    await db.contact_identities.deleteMany({ where: { contact_id: contactId, channel_type: channel.type, external_id: { in: replaced } } })
  }
  const added = [ev.current.phone, ev.current.userId].filter((k): k is string => !!k)
  await linkIdentities(channel, contactId, { externalId: added[0] ?? '', phone: ev.current.phone, userId: ev.current.userId }, added)
  if (ev.current.phone && ev.previous.phone && ev.current.phone !== ev.previous.phone) {
    await db.contacts.updateMany({ where: { id: contactId }, data: { phone: `+${ev.current.phone}` } })
  }
}

export async function findOrCreateConversation(channel: LoadedChannel, contactId: string) {
  const db = tenantDb(channel.workspace_id)
  const existing = await db.conversations.findFirst({
    where: { contact_id: contactId, channel_id: channel.id },
    orderBy: { created_at: 'asc' },
  })
  if (existing) return existing

  try {
    return await db.conversations.create({
      data: { workspace_id: channel.workspace_id, contact_id: contactId, channel_id: channel.id },
    })
  } catch (error) {
    console.error('[ingest] conversation insert failed:', error instanceof Error ? error.message : error)
    return null
  }
}

async function internalIdFor(workspaceId: string, conversationId: string, externalId: string | null | undefined) {
  if (!externalId) return null
  // maybeSingle(): more than one match (or an error) counted as none.
  const rows = await tenantDb(workspaceId)
    .messages.findMany({ where: { conversation_id: conversationId, message_id: externalId }, select: { id: true }, take: 2 })
    .catch(() => [])
  return rows.length === 1 ? rows[0].id : null
}

async function flagBroadcastReply(workspaceId: string, contactId: string) {
  const db = tenantDb(workspaceId)
  const recs = await db.broadcast_recipients
    .findMany({
      where: { contact_id: contactId, status: { in: ['sent', 'delivered', 'read'] } },
      select: { id: true },
      orderBy: { created_at: 'desc' },
      take: 1,
    })
    .catch(() => [])
  if (recs[0]) {
    await db.broadcast_recipients
      .updateMany({ where: { id: recs[0].id }, data: { status: 'replied', replied_at: new Date().toISOString() } })
      .catch(() => {})
  }
}

// ------------------------------------------------------------
// Reactions
// ------------------------------------------------------------
async function applyReaction(channel: LoadedChannel, ev: Extract<InboundEvent, { kind: 'reaction' }>) {
  const db = tenantDb(channel.workspace_id)
  const contact = await findOrCreateContact(channel, ev.from)
  if (!contact) return
  const conversation = await findOrCreateConversation(channel, contact.id)
  if (!conversation) return
  const target = await internalIdFor(channel.workspace_id, conversation.id, ev.targetExternalId)
  if (!target) return
  if (!ev.emoji) {
    await db.message_reactions
      .deleteMany({ where: { message_id: target, actor_type: 'customer', actor_id: contact.id } })
      .catch(() => {})
    return
  }
  const reaction = {
    workspace_id: channel.workspace_id,
    message_id: target,
    conversation_id: conversation.id,
    actor_type: 'customer',
    actor_id: contact.id,
    emoji: ev.emoji,
  }
  await db.message_reactions
    .upsert({
      where: { message_id_actor_type_actor_id: { message_id: target, actor_type: 'customer', actor_id: contact.id } },
      create: reaction,
      update: reaction,
    })
    .catch(() => {})
}

// ------------------------------------------------------------
// Messages
// ------------------------------------------------------------
const DB_CONTENT_TYPE: Record<MessageEvent['contentType'], string> = {
  text: 'text',
  image: 'image',
  video: 'video',
  audio: 'audio',
  document: 'document',
  location: 'location',
  sticker: 'image',
  interactive: 'interactive',
}


/**
 * Stores one inbound customer message and runs the reaction chain:
 * AI agent (if the channel has one and no human took over) → flows →
 * automations.
 */
export async function ingestMessage(channel: LoadedChannel, ev: MessageEvent): Promise<IngestOutcome | null> {
  const ws = channel.workspace_id
  const db = tenantDb(ws)

  const contact = await findOrCreateContact(channel, ev.from)
  if (!contact) return null
  const conversation = await findOrCreateConversation(channel, contact.id)
  if (!conversation) return null

  // Providers retry webhooks: the provider message id makes this idempotent.
  if (ev.externalMessageId) {
    const dups = await db.messages.findMany({
      where: { conversation_id: conversation.id, message_id: ev.externalMessageId },
      select: { id: true },
      take: 2,
    })
    const dup = dups.length === 1 ? dups[0] : null
    if (dup) return { contactId: contact.id, conversationId: conversation.id, messageId: dup.id, duplicate: true }
  }

  const mediaUrl = ev.mediaUrl?.startsWith('wa-media:')
    ? waMediaProxyUrl(channel.id, ev.mediaUrl.slice('wa-media:'.length))
    : ev.mediaUrl ?? null

  const priorInbound = await db.messages
    .count({ where: { conversation_id: conversation.id, sender_type: 'customer' } })
    .catch(() => null)
  const isFirstInboundMessage = (priorInbound ?? 0) === 0

  const replyTo = await internalIdFor(ws, conversation.id, ev.replyToExternalId)
  let inserted: { id: string }
  try {
    inserted = await db.messages.create({
      select: { id: true },
      data: {
      workspace_id: ws,
      conversation_id: conversation.id,
      sender_type: 'customer',
      content_type: DB_CONTENT_TYPE[ev.contentType],
      content_text: ev.text,
      media_url: mediaUrl,
      message_id: ev.externalMessageId,
      status: 'delivered',
      created_at: new Date(ev.timestamp).toISOString(),
      reply_to_message_id: replyTo,
      interactive_reply_id: ev.interactiveReplyId ?? null,
      },
    })
  } catch (error) {
    console.error('[ingest] message insert failed:', error instanceof Error ? error.message : error)
    return null
  }

  const now = new Date().toISOString()
  await db.conversations
    .updateMany({
      where: { id: conversation.id },
      data: {
      last_message_text: ev.text || `[${ev.contentType}]`,
      last_message_at: now,
      unread_count: (conversation.unread_count || 0) + 1,
      last_customer_message_at: new Date(ev.timestamp).toISOString(),
      updated_at: now,
      },
    })
    .catch(() => {})

  await flagBroadcastReply(ws, contact.id)

  // "Seguimientos": the customer answered — drop pending follow-ups and
  // parked waits of follow-up runs for this conversation.
  await cancelFollowupsForInbound(ws, conversation.id).catch((err) =>
    console.error('[ingest] follow-up cancel failed:', err instanceof Error ? err.message : err),
  )

  const outcome: IngestOutcome = { contactId: contact.id, conversationId: conversation.id, messageId: inserted.id, duplicate: false }
  // Reassigned by the AI-assist media hook below (voice note → transcript).
  let text = ev.text ?? ''

  // A conversation that was closed starts over: new topic, new routing.
  let aiState = (conversation.ai_state ?? {}) as unknown as ConversationAiState
  let conversationAgentId: string | null = conversation.ai_agent_id ?? null
  if (conversation.status === 'closed') {
    aiState = {}
    conversationAgentId = null
    await db.conversations
      .updateMany({ where: { id: conversation.id }, data: { status: 'open', ai_agent_id: null, ai_state: {}, resolved_at: null, resolved_by: null } })
      .catch(() => {})
    await recordEvent({ workspaceId: ws, conversationId: conversation.id, type: 'reopened', data: { by: 'customer' } })
  }

  // 0a) Real estate: post-visit answers and "Agendar visita" buttons.
  if (isVisitAction(ev.interactiveReplyId)) {
    const handledVisit = await handleVisitAction(
      { workspaceId: ws, conversationId: conversation.id, contactId: contact.id, aiAgentId: conversationAgentId ?? channel.ai_agent_id },
      ev.interactiveReplyId,
    ).catch((err) => {
      console.error('[ingest] visit action failed:', err)
      return false
    })
    if (handledVisit) return outcome
  }

  // 0b) Booking picker (a flow's booking step or the inbox's "Send
  //     schedule"): the taps and answers book without the AI.
  if (conversation.booking_picker || isPickerReply(ev.interactiveReplyId)) {
    const handledPicker = await handleBookingPickerInbound({
      workspaceId: ws,
      conversationId: conversation.id,
      contactId: contact.id,
      state: conversation.booking_picker,
      replyId: ev.interactiveReplyId ?? null,
      text,
    }).catch((err) => {
      console.error('[ingest] booking picker failed:', err)
      return false
    })
    if (handledPicker) return outcome
  }

  // 0) Shopping: cart/checkout buttons, the answer to a checkout question
  //    (address, name) or a payment screenshot are handled without AI.
  const handledByCommerce = await handleCommerce(channel, conversation, contact.id, ev, mediaUrl, conversationAgentId).catch((err) => {
    console.error('[ingest] commerce handling failed:', err)
    return false
  })
  if (handledByCommerce) return outcome

  // 0b) AI assist: a voice note becomes its transcript (and, when the
  //     workspace enabled it, an image its "[Imagen: …]" description) so
  //     flows and the AI agent can answer it. Never throws or blocks the
  //     pipeline: without a multimodal provider `text` stays as it was.
  if (inserted.id && (ev.contentType === 'audio' || ev.contentType === 'image')) {
    const agentId = conversationAgentId ?? channel.ai_agent_id
    const mediaText = await inboundMediaText({
      workspaceId: ws,
      channelId: channel.id,
      conversationId: conversation.id,
      messageId: inserted.id,
      contentType: ev.contentType,
      mediaUrl,
      caption: ev.text ?? null,
      aiWillAnswer: !!agentId && !(conversation.ai_paused_until && new Date(conversation.ai_paused_until) > new Date()),
      aiAgentId: agentId,
    })
    if (mediaText) text = mediaText
  }

  // 1) Flows first: an active bot-menu run, or a flow whose trigger matches,
  //    owns the message (flows can hand off to an AI agent themselves).
  const flow = await dispatchInboundToFlows({
    workspaceId: ws,
    contactId: contact.id,
    conversationId: conversation.id,
    message: ev.interactiveReplyId
      ? { kind: 'interactive_reply', reply_id: ev.interactiveReplyId, reply_title: text, meta_message_id: ev.externalMessageId }
      : { kind: 'text', text, meta_message_id: ev.externalMessageId },
    isFirstInboundMessage,
  })

  // 2) AI: conversation's agent → channel welcome menu → channel's agent —
  //    unless a human has taken over.
  let aiHandled = false
  const paused = conversation.ai_paused_until && new Date(conversation.ai_paused_until) > new Date()
  if (!flow.consumed && !paused) {
    aiHandled = await routeInbound({
      workspaceId: ws,
      channel,
      contactId: contact.id,
      conversationId: conversation.id,
      messageText: text,
      interactiveReplyId: ev.interactiveReplyId ?? null,
      contextMessageId: ev.externalMessageId,
      isFirstInboundMessage,
      conversationAgentId,
      aiState,
    }).catch((err) => {
      console.error('[ingest] AI routing failed:', err)
      return false
    })
  }

  // 2b) Nobody owns a brand-new conversation (no AI agent, no person):
  //     round-robin auto-assignment when the workspace enabled it.
  if (isFirstInboundMessage && !flow.consumed && !aiHandled && !conversation.assigned_agent_id && !(conversationAgentId ?? channel.ai_agent_id)) {
    await autoAssignConversation(ws, conversation.id, 'new_conversation')
  }

  // 3) Automations (fire-and-forget).
  const triggers: ('new_contact_created' | 'first_inbound_message' | 'new_message_received' | 'keyword_match')[] = []
  if (contact.wasCreated) triggers.push('new_contact_created')
  if (isFirstInboundMessage) triggers.push('first_inbound_message')
  if (!flow.consumed && !aiHandled) triggers.push('new_message_received', 'keyword_match')
  for (const triggerType of triggers) {
    runAutomationsForTrigger({
      workspaceId: ws,
      triggerType,
      contactId: contact.id,
      context: { message_text: text, conversation_id: conversation.id },
    }).catch((err) => console.error('[ingest] automation dispatch failed:', err))
  }

  return outcome
}

async function handleCommerce(
  channel: LoadedChannel,
  conversation: { id: string; ai_paused_until?: string | null },
  contactId: string,
  ev: MessageEvent,
  mediaUrl: string | null,
  conversationAgentId: string | null,
): Promise<boolean> {
  const isAction = isCommerceAction(ev.interactiveReplyId)
  const isImage = ev.contentType === 'image' && !!mediaUrl
  const maybeCheckoutText = ev.contentType === 'text' && !!ev.text?.trim()
  if (!isAction && !isImage && !maybeCheckoutText) return false

  // Plain text only matters while checkout waits for an answer: check that
  // cheaply before loading anything else (this runs on every message).
  if (!isAction && !isImage) {
    const waiting = await tenantDb(channel.workspace_id)
      .carts.findFirst({
        where: {
          conversation_id: conversation.id,
          status: 'open',
          OR: [
            { checkout: { path: ['step'], equals: 'address' } },
            { checkout: { path: ['step'], equals: 'name' } },
          ],
        },
        select: { id: true },
      })
      .catch(() => null)
    if (!waiting) return false
  }

  const workspace = await tenantDb(channel.workspace_id)
    .workspaces.findFirst({ where: { id: channel.workspace_id } })
    .catch(() => null)
  const ctx: CommerceCtx = {
    workspace: workspace as unknown as Workspace,
    channel,
    conversationId: conversation.id,
    contactId,
    aiAgentId: conversationAgentId ?? channel.ai_agent_id,
  }
  if (isAction) return handleCommerceAction(ctx, ev.interactiveReplyId!)
  if (isImage) return handlePaymentProof(ctx, mediaUrl!)
  return handleCheckoutText(ctx, ev.text!)
}

/** Entry point for every webhook / web-chat post. */
export async function ingestEvents(channel: LoadedChannel, events: InboundEvent[]): Promise<void> {
  // Statuses first: a batch can carry a status for a message we sent
  // right before the customer's reply.
  for (const ev of events) {
    try {
      if (ev.kind === 'status') await applyStatus(channel, ev)
    } catch (err) {
      console.error('[ingest] status failed:', err)
    }
  }
  for (const ev of events) {
    try {
      if (ev.kind === 'reaction') await applyReaction(channel, ev)
      else if (ev.kind === 'message') await ingestMessage(channel, ev)
      else if (ev.kind === 'identity_change') await applyIdentityChange(channel, ev)
    } catch (err) {
      console.error(`[ingest] ${ev.kind} failed:`, err)
    }
  }
}

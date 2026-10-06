import 'server-only'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { phonesMatch } from '@/lib/whatsapp/phone-utils'
import { waMediaProxyUrl } from '@/lib/channels/parsers/whatsapp'
import type { InboundEvent, LoadedChannel } from '@/lib/channels'
import type { AiAgentRow } from '@/lib/ai/types'
import { routeInbound } from '@/lib/ai/routing'
import type { ConversationAiState } from '@/lib/ai/types'
import { dispatchInboundToFlows } from '@/lib/flows/engine'
import { runAutomationsForTrigger } from '@/lib/automations/engine'

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
  const db = supabaseAdmin()
  const { data: msg } = await db
    .from('messages')
    .select('id, status, metadata')
    .eq('workspace_id', channel.workspace_id)
    .eq('message_id', ev.externalMessageId)
    .maybeSingle()
  if (msg && (MESSAGE_STATUS_RANK[ev.status] ?? 0) > (MESSAGE_STATUS_RANK[msg.status] ?? 0)) {
    await db
      .from('messages')
      .update({
        status: ev.status,
        ...(ev.error ? { metadata: { ...(msg.metadata ?? {}), error: ev.error } } : {}),
      })
      .eq('id', msg.id)
  }

  const { data: recipient } = await db
    .from('broadcast_recipients')
    .select('id, status')
    .eq('workspace_id', channel.workspace_id)
    .eq('whatsapp_message_id', ev.externalMessageId)
    .maybeSingle()
  if (!recipient || !isValidStatusTransition(recipient.status, ev.status)) return
  const ts = new Date(ev.timestamp).toISOString()
  await db
    .from('broadcast_recipients')
    .update({
      status: ev.status,
      ...(ev.status === 'sent' ? { sent_at: ts } : {}),
      ...(ev.status === 'delivered' ? { delivered_at: ts } : {}),
      ...(ev.status === 'read' ? { read_at: ts } : {}),
      ...(ev.status === 'failed' && ev.error ? { error_message: ev.error } : {}),
    })
    .eq('id', recipient.id)
}

// ------------------------------------------------------------
// Contacts & conversations
// ------------------------------------------------------------
async function findOrCreateContact(
  channel: LoadedChannel,
  from: MessageEvent['from'],
): Promise<{ id: string; wasCreated: boolean } | null> {
  const db = supabaseAdmin()
  const ws = channel.workspace_id

  const { data: identity } = await db
    .from('contact_identities')
    .select('contact_id')
    .eq('workspace_id', ws)
    .eq('channel_type', channel.type)
    .eq('external_id', from.externalId)
    .maybeSingle()
  if (identity) return { id: identity.contact_id, wasCreated: false }

  // WhatsApp: a contact created by hand / CSV import has a phone but no
  // identity yet. Match it (tolerating formatting) before creating one.
  let contactId: string | null = null
  let wasCreated = false
  if (from.phone) {
    const { data: candidates } = await db
      .from('contacts')
      .select('id, phone')
      .eq('workspace_id', ws)
      .not('phone', 'is', null)
    contactId = candidates?.find((c) => phonesMatch(c.phone, from.phone!))?.id ?? null
  }

  if (!contactId) {
    const fallbackName =
      from.name || from.handle || from.phone || `${channel.type} ${from.externalId.slice(-4)}`
    const { data: created, error } = await db
      .from('contacts')
      .insert({ workspace_id: ws, name: fallbackName, phone: from.phone ?? null })
      .select('id')
      .single()
    if (error || !created) {
      console.error('[ingest] contact insert failed:', error?.message)
      return null
    }
    contactId = created.id
    wasCreated = true
  }

  const { error: idErr } = await db.from('contact_identities').insert({
    workspace_id: ws,
    contact_id: contactId,
    channel_type: channel.type,
    external_id: from.externalId,
    handle: from.handle ?? from.phone ?? null,
  })
  if (idErr && idErr.code === '23505') {
    // Concurrent first message created it a moment ago: use that one.
    const { data: winner } = await db
      .from('contact_identities')
      .select('contact_id')
      .eq('workspace_id', ws)
      .eq('channel_type', channel.type)
      .eq('external_id', from.externalId)
      .single()
    if (wasCreated && winner && winner.contact_id !== contactId) {
      await db.from('contacts').delete().eq('id', contactId)
    }
    return winner ? { id: winner.contact_id, wasCreated: false } : null
  }
  return { id: contactId!, wasCreated }
}

async function findOrCreateConversation(channel: LoadedChannel, contactId: string) {
  const db = supabaseAdmin()
  const { data: existing } = await db
    .from('conversations')
    .select('*')
    .eq('workspace_id', channel.workspace_id)
    .eq('contact_id', contactId)
    .eq('channel_id', channel.id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (existing) return existing

  const { data: created, error } = await db
    .from('conversations')
    .insert({ workspace_id: channel.workspace_id, contact_id: contactId, channel_id: channel.id })
    .select('*')
    .single()
  if (error) {
    console.error('[ingest] conversation insert failed:', error.message)
    return null
  }
  return created
}

async function internalIdFor(conversationId: string, externalId: string | null | undefined) {
  if (!externalId) return null
  const { data } = await supabaseAdmin()
    .from('messages')
    .select('id')
    .eq('conversation_id', conversationId)
    .eq('message_id', externalId)
    .maybeSingle()
  return data?.id ?? null
}

async function flagBroadcastReply(workspaceId: string, contactId: string) {
  const db = supabaseAdmin()
  const { data: recs } = await db
    .from('broadcast_recipients')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('contact_id', contactId)
    .in('status', ['sent', 'delivered', 'read'])
    .order('created_at', { ascending: false })
    .limit(1)
  if (recs?.[0]) {
    await db
      .from('broadcast_recipients')
      .update({ status: 'replied', replied_at: new Date().toISOString() })
      .eq('id', recs[0].id)
  }
}

// ------------------------------------------------------------
// Reactions
// ------------------------------------------------------------
async function applyReaction(channel: LoadedChannel, ev: Extract<InboundEvent, { kind: 'reaction' }>) {
  const db = supabaseAdmin()
  const contact = await findOrCreateContact(channel, { externalId: ev.from.externalId })
  if (!contact) return
  const conversation = await findOrCreateConversation(channel, contact.id)
  if (!conversation) return
  const target = await internalIdFor(conversation.id, ev.targetExternalId)
  if (!target) return
  if (!ev.emoji) {
    await db
      .from('message_reactions')
      .delete()
      .eq('workspace_id', channel.workspace_id)
      .eq('message_id', target)
      .eq('actor_type', 'customer')
      .eq('actor_id', contact.id)
    return
  }
  await db.from('message_reactions').upsert(
    {
      workspace_id: channel.workspace_id,
      message_id: target,
      conversation_id: conversation.id,
      actor_type: 'customer',
      actor_id: contact.id,
      emoji: ev.emoji,
    },
    { onConflict: 'message_id,actor_type,actor_id' },
  )
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
  const db = supabaseAdmin()
  const ws = channel.workspace_id

  const contact = await findOrCreateContact(channel, ev.from)
  if (!contact) return null
  const conversation = await findOrCreateConversation(channel, contact.id)
  if (!conversation) return null

  // Providers retry webhooks: the provider message id makes this idempotent.
  if (ev.externalMessageId) {
    const { data: dup } = await db
      .from('messages')
      .select('id')
      .eq('workspace_id', ws)
      .eq('conversation_id', conversation.id)
      .eq('message_id', ev.externalMessageId)
      .maybeSingle()
    if (dup) return { contactId: contact.id, conversationId: conversation.id, messageId: dup.id, duplicate: true }
  }

  const mediaUrl = ev.mediaUrl?.startsWith('wa-media:')
    ? waMediaProxyUrl(channel.id, ev.mediaUrl.slice('wa-media:'.length))
    : ev.mediaUrl ?? null

  const { count: priorInbound } = await db
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversation.id)
    .eq('sender_type', 'customer')
  const isFirstInboundMessage = (priorInbound ?? 0) === 0

  const { data: inserted, error } = await db
    .from('messages')
    .insert({
      workspace_id: ws,
      conversation_id: conversation.id,
      sender_type: 'customer',
      content_type: DB_CONTENT_TYPE[ev.contentType],
      content_text: ev.text,
      media_url: mediaUrl,
      message_id: ev.externalMessageId,
      status: 'delivered',
      created_at: new Date(ev.timestamp).toISOString(),
      reply_to_message_id: await internalIdFor(conversation.id, ev.replyToExternalId),
      interactive_reply_id: ev.interactiveReplyId ?? null,
    })
    .select('id')
    .single()
  if (error) {
    console.error('[ingest] message insert failed:', error.message)
    return null
  }

  const now = new Date().toISOString()
  await db
    .from('conversations')
    .update({
      last_message_text: ev.text || `[${ev.contentType}]`,
      last_message_at: now,
      unread_count: (conversation.unread_count || 0) + 1,
      updated_at: now,
    })
    .eq('id', conversation.id)

  await flagBroadcastReply(ws, contact.id)

  const outcome: IngestOutcome = { contactId: contact.id, conversationId: conversation.id, messageId: inserted.id, duplicate: false }
  const text = ev.text ?? ''

  // A conversation that was closed starts over: new topic, new routing.
  let aiState = (conversation.ai_state ?? {}) as ConversationAiState
  let conversationAgentId: string | null = conversation.ai_agent_id ?? null
  if (conversation.status === 'closed') {
    aiState = {}
    conversationAgentId = null
    await db.from('conversations').update({ status: 'open', ai_agent_id: null, ai_state: {} }).eq('id', conversation.id)
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
    } catch (err) {
      console.error(`[ingest] ${ev.kind} failed:`, err)
    }
  }
}

import 'server-only'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAdapter, ChannelSendError, type LoadedChannel, type OutboundContent } from '@/lib/channels'
import { defaultChannel, loadChannel } from '@/lib/channels/store'
import { armFollowupsForOutbound } from '@/lib/automations/followups'

export type SenderType = 'agent' | 'bot'

export interface SendMessageInput {
  workspaceId: string
  conversationId: string
  content: OutboundContent
  sender: { type: SenderType; userId?: string | null; aiAgentId?: string | null }
  /** Internal id (messages.id) of the message being replied to. */
  replyToMessageId?: string | null
  /** Extra data stored on the message row (e.g. flow node id). */
  metadata?: Record<string, unknown>
}

export interface SendMessageResult {
  messageId: string
  externalId: string | null
  status: 'sent' | 'delivered' | 'failed'
  error?: string
}

/** Text we store/show for any outbound content. */
export function contentPreview(content: OutboundContent): string {
  switch (content.type) {
    case 'text':
      return content.text
    case 'media':
      return content.caption ?? `[${content.mediaType}]`
    case 'buttons':
    case 'list':
    case 'carousel':
      return content.text
    case 'template':
      return `[Template: ${content.templateName}]`
  }
}

function dbContentType(content: OutboundContent): string {
  switch (content.type) {
    case 'text':
      return 'text'
    case 'media':
      return content.mediaType
    case 'buttons':
    case 'list':
    case 'carousel':
      return 'interactive'
    case 'template':
      return 'template'
  }
}

/**
 * Recipient id on this channel: the contact identity for the channel
 * type, falling back to the phone number for WhatsApp.
 */
async function resolveRecipient(channel: LoadedChannel, contactId: string): Promise<string | null> {
  const db = supabaseAdmin()
  const { data: identity } = await db
    .from('contact_identities')
    .select('external_id')
    .eq('workspace_id', channel.workspace_id)
    .eq('contact_id', contactId)
    .eq('channel_type', channel.type)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (identity?.external_id) return identity.external_id
  if (channel.type === 'whatsapp') {
    const { data: contact } = await db.from('contacts').select('phone').eq('id', contactId).maybeSingle()
    return contact?.phone ?? null
  }
  return null
}

/**
 * The one way to send a message: resolves the conversation's channel,
 * sends through its adapter, stores the message row and bumps the
 * conversation. Failures are stored as status='failed' (so the inbox
 * shows them) and reported in the result instead of thrown.
 */
export async function sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
  const db = supabaseAdmin()
  const { workspaceId, conversationId, content, sender } = input

  const { data: conversation, error: convErr } = await db
    .from('conversations')
    .select('id, contact_id, channel_id')
    .eq('id', conversationId)
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  if (convErr || !conversation) throw new Error('Conversation not found')

  const channel = conversation.channel_id
    ? await loadChannel(workspaceId, conversation.channel_id)
    : await defaultChannel(workspaceId, 'whatsapp')

  let replyToExternalId: string | null = null
  if (input.replyToMessageId) {
    const { data: parent } = await db
      .from('messages')
      .select('message_id')
      .eq('id', input.replyToMessageId)
      .eq('conversation_id', conversationId)
      .maybeSingle()
    replyToExternalId = parent?.message_id ?? null
  }

  let externalId: string | null = null
  let status: SendMessageResult['status'] = 'sent'
  let error: string | undefined
  let usedRecipient: string | undefined

  try {
    if (!channel) throw new ChannelSendError('No channel connected for this conversation', 'not_configured')
    const recipient = await resolveRecipient(channel, conversation.contact_id)
    if (!recipient) throw new ChannelSendError(`Contact has no ${channel.type} identity`, 'unsupported')
    const result = await getAdapter(channel.type).send({ channel, recipient, replyToExternalId }, content)
    externalId = result.externalId
    usedRecipient = result.recipient
    // Web chat has no provider round-trip: the row is the delivery.
    if (channel.type === 'webchat') status = 'delivered'
  } catch (err) {
    status = 'failed'
    error = err instanceof Error ? err.message : String(err)
  }

  const now = new Date().toISOString()
  const preview = contentPreview(content)
  const { data: row, error: insErr } = await db
    .from('messages')
    .insert({
      workspace_id: workspaceId,
      conversation_id: conversationId,
      sender_type: sender.type,
      sender_id: sender.userId ?? null,
      ai_agent_id: sender.aiAgentId ?? null,
      content_type: dbContentType(content),
      content_text: preview,
      media_url: content.type === 'media' ? content.url : null,
      template_name: content.type === 'template' ? content.templateName : null,
      message_id: externalId,
      status,
      reply_to_message_id: input.replyToMessageId ?? null,
      metadata: {
        ...(input.metadata ?? {}),
        ...(content.type === 'buttons' ? { options: content.options } : {}),
        ...(content.type === 'list' ? { sections: content.sections, button_label: content.buttonLabel } : {}),
        ...(content.type === 'carousel' ? { cards: content.cards } : {}),
        ...(error ? { error } : {}),
      },
    })
    .select('id')
    .single()
  if (insErr) throw insErr

  if (status !== 'failed') {
    await db
      .from('conversations')
      .update({ last_message_text: preview, last_message_at: now, updated_at: now })
      .eq('id', conversationId)

    // WhatsApp may have accepted a different variant of the number;
    // remember it so the next send goes straight through.
    if (channel?.type === 'whatsapp' && usedRecipient) {
      await db
        .from('contacts')
        .update({ phone: `+${usedRecipient}` })
        .eq('id', conversation.contact_id)
        .neq('phone', `+${usedRecipient}`)
    }

    // "Seguimientos": we spoke last — (re)arm the no_reply automations.
    // Never let scheduling break a send.
    try {
      await armFollowupsForOutbound({
        workspaceId,
        conversationId,
        contactId: conversation.contact_id,
        channelId: conversation.channel_id ?? channel?.id ?? null,
        messageId: row.id,
        status,
        metadata: input.metadata,
      })
    } catch (err) {
      console.error('[send] follow-up scheduling failed:', err instanceof Error ? err.message : err)
    }
  }

  return { messageId: row.id, externalId, status, ...(error ? { error } : {}) }
}

/** Reaction on a message (agent side). */
export async function sendReaction(input: {
  workspaceId: string
  conversationId: string
  messageId: string
  emoji: string
}): Promise<void> {
  const db = supabaseAdmin()
  const { data: msg } = await db
    .from('messages')
    .select('message_id, conversation:conversations(contact_id, channel_id)')
    .eq('id', input.messageId)
    .eq('conversation_id', input.conversationId)
    .eq('workspace_id', input.workspaceId)
    .maybeSingle()
  const conv = msg?.conversation as unknown as { contact_id: string; channel_id: string | null } | null
  if (!msg?.message_id || !conv) return
  const channel = conv.channel_id
    ? await loadChannel(input.workspaceId, conv.channel_id)
    : await defaultChannel(input.workspaceId, 'whatsapp')
  if (!channel) return
  const adapter = getAdapter(channel.type)
  if (!adapter.sendReaction) return
  const recipient = await resolveRecipient(channel, conv.contact_id)
  if (!recipient) return
  await adapter.sendReaction({ channel, recipient }, msg.message_id, input.emoji)
}

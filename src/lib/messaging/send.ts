import 'server-only'
import type { Prisma } from '@/generated/prisma/client'
import { tenantDb } from '@/lib/db/tenant'
import { getAdapter, ChannelSendError, type LoadedChannel, type OutboundContent } from '@/lib/channels'
import { locationText } from '@/lib/channels/types'
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
    case 'location':
      return locationText(content)
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
    case 'location':
      return 'location'
  }
}

/**
 * Recipient id on this channel: the contact identity for the channel
 * type, falling back to the phone number for WhatsApp.
 */
async function resolveRecipient(channel: LoadedChannel, contactId: string): Promise<string | null> {
  const db = tenantDb(channel.workspace_id)
  const identity = await db.contact_identities.findFirst({
    where: { contact_id: contactId, channel_type: channel.type },
    select: { external_id: true },
    orderBy: { created_at: 'desc' },
  })
  if (identity?.external_id) return identity.external_id
  if (channel.type === 'whatsapp') {
    const contact = await db.contacts.findFirst({ where: { id: contactId }, select: { phone: true } })
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
  const { workspaceId, conversationId, content, sender } = input
  const db = tenantDb(workspaceId)

  const conversation = await db.conversations
    .findFirst({ where: { id: conversationId }, select: { id: true, contact_id: true, channel_id: true } })
    .catch(() => null)
  if (!conversation) throw new Error('Conversation not found')

  const channel = conversation.channel_id
    ? await loadChannel(workspaceId, conversation.channel_id)
    : await defaultChannel(workspaceId, 'whatsapp')

  let replyToExternalId: string | null = null
  if (input.replyToMessageId) {
    const parent = await db.messages
      .findFirst({ where: { id: input.replyToMessageId, conversation_id: conversationId }, select: { message_id: true } })
      .catch(() => null)
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
  const row = await db.messages.create({
    select: { id: true },
    data: {
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
        ...(content.type === 'location'
          ? { location: { latitude: content.latitude, longitude: content.longitude, name: content.name ?? null, address: content.address ?? null } }
          : {}),
        ...(error ? { error } : {}),
      } as Prisma.InputJsonObject,
    },
  })

  if (status !== 'failed') {
    await db.conversations
      .updateMany({ where: { id: conversationId }, data: { last_message_text: preview, last_message_at: now, updated_at: now } })
      .catch(() => {})

    // WhatsApp may have accepted a different variant of the number;
    // remember it so the next send goes straight through.
    if (channel?.type === 'whatsapp' && usedRecipient) {
      await db.contacts
        .updateMany({
          where: { id: conversation.contact_id, phone: { not: `+${usedRecipient}` } },
          data: { phone: `+${usedRecipient}` },
        })
        .catch(() => {})
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
  const msg = await tenantDb(input.workspaceId)
    .messages.findFirst({
      where: { id: input.messageId, conversation_id: input.conversationId },
      select: { message_id: true, conversations: { select: { contact_id: true, channel_id: true } } },
    })
    .catch(() => null)
  const conv = msg?.conversations ?? null
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

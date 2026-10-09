import 'server-only'
import { tenantDb } from '@/lib/db/tenant'
import { sendMessage } from '@/lib/messaging/send'
import { CHANNEL_TYPES, type OutboundContent } from '@/lib/channels'
import { supportsTemplates, windowState } from '@/lib/automations/followup-rules'
import type { ApiContext } from './auth'
import { ApiError, badRequest, notFound, unprocessable } from './errors'
import { keysetPage, selectOf } from './keyset'
import { parseIsoParam } from './pagination'
import { MESSAGE_SELECT, serializeConversation, serializeMessage } from './serializers'
import { isUuidLike, oneOf, queryEnum, queryUuid, str, strArray, httpUrl } from './validate'

const STATUSES = ['open', 'pending', 'closed'] as const
const MEDIA_TYPES = ['image', 'video', 'audio', 'document'] as const

// CONVERSATION_SELECT (serializers.ts) as a Prisma select; the relations are
// renamed back to the PostgREST aliases (channel, contact) by conversationShape.
const CONVERSATION_FIELDS = {
  id: true,
  contact_id: true,
  status: true,
  priority: true,
  assigned_agent_id: true,
  team_id: true,
  ai_agent_id: true,
  unread_count: true,
  last_message_text: true,
  last_message_at: true,
  last_customer_message_at: true,
  resolved_at: true,
  created_at: true,
  updated_at: true,
  channels: { select: { id: true, type: true, name: true } },
  contacts: { select: { id: true, name: true, phone: true, email: true } },
} as const

const MESSAGE_FIELDS = selectOf(MESSAGE_SELECT)

type ConversationRow = Record<string, unknown> & {
  id: string
  contact_id: string
  last_customer_message_at: string | null
  channel: { id: string; type: string; name: string } | null
}

function conversationShape(r: Record<string, unknown> & { channels: unknown; contacts: unknown }): ConversationRow {
  const { channels, contacts, ...rest } = r
  return { ...rest, channel: channels ?? null, contact: contacts ?? null } as unknown as ConversationRow
}

export async function listConversations(workspaceId: string, url: URL) {
  const sp = url.searchParams
  const channel = queryEnum(url, 'channel', CHANNEL_TYPES)
  const where: Record<string, unknown> = { workspace_id: workspaceId }
  const status = queryEnum(url, 'status', STATUSES)
  if (status) where.status = status
  // channels!inner + channel.type filter: only conversations on that channel type.
  if (channel) where.channels = { is: { type: channel } }
  const assigned = sp.get('assigned')
  if (assigned === 'none') where.assigned_agent_id = null
  else if (assigned === 'any') where.assigned_agent_id = { not: null }
  else if (assigned) {
    if (!isUuidLike(assigned)) throw badRequest('assigned must be a user id, "none" or "any".', { field: 'assigned' })
    where.assigned_agent_id = assigned
  }
  const contactId = queryUuid(url, 'contact_id')
  if (contactId) where.contact_id = contactId
  const since = parseIsoParam(sp.get('updated_since'))
  if (since) where.updated_at = { gte: since }
  const db = tenantDb(workspaceId)
  const page = await keysetPage({
    workspaceId,
    table: 'conversations',
    column: 'updated_at',
    where,
    url,
    findMany: async (args) => (await db.conversations.findMany({ ...args, select: CONVERSATION_FIELDS })).map(conversationShape),
  })
  return { data: page.data.map(serializeConversation), next_cursor: page.next_cursor }
}

async function conversationRow(workspaceId: string, id: string) {
  if (!isUuidLike(id)) throw notFound('Conversation')
  const data = await tenantDb(workspaceId)
    .conversations.findFirst({ select: CONVERSATION_FIELDS, where: { id, workspace_id: workspaceId } })
    .catch(() => null)
  if (!data) throw notFound('Conversation')
  return conversationShape(data)
}

export async function getConversation(workspaceId: string, id: string) {
  return serializeConversation(await conversationRow(workspaceId, id))
}

/** Messages of a conversation, newest first. Internal notes are never exposed. */
export async function listMessages(workspaceId: string, conversationId: string, url: URL) {
  const conv = await conversationRow(workspaceId, conversationId)
  const where: Record<string, unknown> = { workspace_id: workspaceId, conversation_id: conversationId, is_internal: false }
  const since = parseIsoParam(url.searchParams.get('created_since'))
  if (since) where.created_at = { gte: since }
  const db = tenantDb(workspaceId)
  const page = await keysetPage({
    workspaceId,
    table: 'messages',
    column: 'created_at',
    where,
    url,
    findMany: (args) => db.messages.findMany({ ...args, select: MESSAGE_FIELDS }) as unknown as Promise<(Record<string, unknown> & { id: string })[]>,
  })
  const meta = { contact_id: conv.contact_id, channel_type: conv.channel?.type ?? null }
  return { data: page.data.map((m) => serializeMessage(m, meta)), next_cursor: page.next_cursor }
}

/**
 * POST /conversations/{id}/messages. Body:
 *   { type: 'text', text }
 *   { type: 'media', media_type: image|video|audio|document, url, caption?, filename? }
 *   { type: 'template', template_name, language?, params?: string[] }   (WhatsApp)
 * Outside the channel's reply window (24 h on WhatsApp) only templates go out.
 */
export async function sendConversationMessage(ctx: ApiContext, conversationId: string, body: Record<string, unknown>) {
  const ws = ctx.workspace.id
  const conv = await conversationRow(ws, conversationId)
  const channelType = (conv.channel?.type ?? 'whatsapp') as (typeof CHANNEL_TYPES)[number]
  const type = oneOf(body, 'type', ['text', 'media', 'template'] as const, { required: true })!

  let content: OutboundContent
  if (type === 'text') {
    content = { type: 'text', text: str(body, 'text', { required: true, max: 4096 })! }
  } else if (type === 'media') {
    const mediaType = oneOf(body, 'media_type', MEDIA_TYPES, { required: true })!
    const mediaUrl = httpUrl(body, 'url', { required: true })!
    content = {
      type: 'media',
      mediaType,
      url: mediaUrl,
      caption: str(body, 'caption', { max: 1024 }) ?? undefined,
      filename: str(body, 'filename', { max: 200 }) ?? undefined,
    }
  } else {
    if (!supportsTemplates(channelType)) throw unprocessable('templates_unsupported', `Templates can't be sent on ${channelType} conversations.`)
    const templateName = str(body, 'template_name', { required: true, max: 512 })!
    let language = str(body, 'language', { max: 20 }) ?? undefined
    if (!language) {
      const tpl = await tenantDb(ws)
        .message_templates.findFirst({ select: { language: true }, where: { workspace_id: ws, name: templateName } })
        .catch(() => null)
      language = tpl?.language ?? undefined
    }
    content = { type: 'template', templateName, language, params: strArray(body, 'params', { max: 20, itemMax: 1024 }) ?? [] }
  }

  if (content.type !== 'template') {
    const win = windowState(channelType, conv.last_customer_message_at)
    if (!win.open) {
      throw unprocessable('window_closed', `The ${win.hours} h reply window is closed for this conversation: send an approved template instead.`)
    }
  }

  const result = await sendMessage({
    workspaceId: ws,
    conversationId,
    content,
    sender: { type: 'agent', userId: null },
    metadata: { source: 'api', api_key_id: ctx.keyId, api_key_name: ctx.keyName },
  })

  const row = await tenantDb(ws)
    .messages.findFirst({ select: MESSAGE_FIELDS, where: { id: result.messageId, workspace_id: ws } })
    .catch(() => null)
  const message = serializeMessage(row as Record<string, unknown>, { contact_id: conv.contact_id, channel_type: conv.channel?.type ?? null })
  if (result.status === 'failed') {
    throw new ApiError(502, 'send_failed', result.error ?? 'The channel rejected the message.', { message_id: result.messageId })
  }
  return { data: message }
}

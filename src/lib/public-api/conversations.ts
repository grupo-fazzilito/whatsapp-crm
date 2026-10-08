import 'server-only'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { sendMessage } from '@/lib/messaging/send'
import { CHANNEL_TYPES, type OutboundContent } from '@/lib/channels'
import { supportsTemplates, windowState } from '@/lib/automations/followup-rules'
import type { ApiContext } from './auth'
import { ApiError, badRequest, notFound, unprocessable } from './errors'
import { listPage } from './list'
import { parseIsoParam } from './pagination'
import { CONVERSATION_SELECT, MESSAGE_SELECT, serializeConversation, serializeMessage } from './serializers'
import { isUuidLike, oneOf, queryEnum, queryUuid, str, strArray, httpUrl } from './validate'

const STATUSES = ['open', 'pending', 'closed'] as const
const MEDIA_TYPES = ['image', 'video', 'audio', 'document'] as const

export async function listConversations(workspaceId: string, url: URL) {
  const sp = url.searchParams
  const channel = queryEnum(url, 'channel', CHANNEL_TYPES)
  let q = supabaseAdmin()
    .from('conversations')
    .select(channel ? CONVERSATION_SELECT.replace('channel:channels(', 'channel:channels!inner(') : CONVERSATION_SELECT)
    .eq('workspace_id', workspaceId)
  const status = queryEnum(url, 'status', STATUSES)
  if (status) q = q.eq('status', status)
  if (channel) q = q.eq('channel.type', channel)
  const assigned = sp.get('assigned')
  if (assigned === 'none') q = q.is('assigned_agent_id', null)
  else if (assigned === 'any') q = q.not('assigned_agent_id', 'is', null)
  else if (assigned) {
    if (!isUuidLike(assigned)) throw badRequest('assigned must be a user id, "none" or "any".', { field: 'assigned' })
    q = q.eq('assigned_agent_id', assigned)
  }
  const contactId = queryUuid(url, 'contact_id')
  if (contactId) q = q.eq('contact_id', contactId)
  const since = parseIsoParam(sp.get('updated_since'))
  if (since) q = q.gte('updated_at', since)
  const page = await listPage<Record<string, unknown> & { id: string }>(q, 'updated_at', url)
  return { data: page.data.map(serializeConversation), next_cursor: page.next_cursor }
}

async function conversationRow(workspaceId: string, id: string) {
  if (!isUuidLike(id)) throw notFound('Conversation')
  const { data } = await supabaseAdmin().from('conversations').select(CONVERSATION_SELECT).eq('id', id).eq('workspace_id', workspaceId).maybeSingle()
  if (!data) throw notFound('Conversation')
  return data as unknown as Record<string, unknown> & { id: string; contact_id: string; last_customer_message_at: string | null; channel: { type: string } | null }
}

export async function getConversation(workspaceId: string, id: string) {
  return serializeConversation(await conversationRow(workspaceId, id))
}

/** Messages of a conversation, newest first. Internal notes are never exposed. */
export async function listMessages(workspaceId: string, conversationId: string, url: URL) {
  const conv = await conversationRow(workspaceId, conversationId)
  let q = supabaseAdmin()
    .from('messages')
    .select(MESSAGE_SELECT)
    .eq('workspace_id', workspaceId)
    .eq('conversation_id', conversationId)
    .eq('is_internal', false)
  const since = parseIsoParam(url.searchParams.get('created_since'))
  if (since) q = q.gte('created_at', since)
  const page = await listPage<Record<string, unknown> & { id: string }>(q, 'created_at', url)
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
      const { data: tpl } = await supabaseAdmin()
        .from('message_templates')
        .select('language')
        .eq('workspace_id', ws)
        .eq('name', templateName)
        .limit(1)
        .maybeSingle()
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

  const { data: row } = await supabaseAdmin().from('messages').select(MESSAGE_SELECT).eq('id', result.messageId).eq('workspace_id', ws).single()
  const message = serializeMessage(row as Record<string, unknown>, { contact_id: conv.contact_id, channel_type: conv.channel?.type ?? null })
  if (result.status === 'failed') {
    throw new ApiError(502, 'send_failed', result.error ?? 'The channel rejected the message.', { message_id: result.messageId })
  }
  return { data: message }
}

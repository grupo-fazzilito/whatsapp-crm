import 'server-only'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { normalizePhone, phonesMatch } from '@/lib/whatsapp/phone-utils'
import { defaultChannel } from '@/lib/channels/store'
import type { LoadedChannel, OutboundContent } from '@/lib/channels'
import { sendMessage, type SendMessageInput, type SendMessageResult } from './send'

/**
 * Helpers for outbound-first sends (broadcasts, reminders, campaigns):
 * make sure there is a contact + identity + conversation on a channel so
 * sendMessage() has something to send into.
 */

/** Contact in the workspace with this phone (formatting-tolerant), created if missing. */
export async function findOrCreateContactByPhone(
  workspaceId: string,
  phone: string,
  name?: string | null,
): Promise<string | null> {
  const db = supabaseAdmin()
  const digits = normalizePhone(phone)
  if (!digits) return null

  const { data: exact } = await db
    .from('contacts')
    .select('id')
    .eq('workspace_id', workspaceId)
    .in('phone', [`+${digits}`, digits, phone])
    .limit(1)
    .maybeSingle()
  if (exact) return exact.id

  const { data: candidates } = await db
    .from('contacts')
    .select('id, phone')
    .eq('workspace_id', workspaceId)
    .not('phone', 'is', null)
  const match = candidates?.find((c) => phonesMatch(c.phone, digits))
  if (match) return match.id

  const { data: created, error } = await db
    .from('contacts')
    .insert({ workspace_id: workspaceId, name: name || `+${digits}`, phone: `+${digits}` })
    .select('id')
    .single()
  if (error || !created) {
    console.error('[conversations] contact insert failed:', error?.message)
    return null
  }
  return created.id
}

/** Best-effort WhatsApp identity (wa id = phone digits) for a contact. */
async function ensureWhatsAppIdentity(workspaceId: string, contactId: string) {
  const db = supabaseAdmin()
  const { data: existing } = await db
    .from('contact_identities')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('contact_id', contactId)
    .eq('channel_type', 'whatsapp')
    .limit(1)
    .maybeSingle()
  if (existing) return
  const { data: contact } = await db.from('contacts').select('phone').eq('id', contactId).maybeSingle()
  const digits = normalizePhone(contact?.phone ?? '')
  if (!digits) return
  // A unique violation means another contact already owns this number on
  // WhatsApp; sendMessage falls back to the contact's phone anyway.
  await db.from('contact_identities').insert({
    workspace_id: workspaceId,
    contact_id: contactId,
    channel_type: 'whatsapp',
    external_id: digits,
    handle: digits,
  })
}

/**
 * Conversation of a contact on a channel; adopts a legacy conversation
 * without channel, or creates one.
 */
export async function findOrCreateConversationOnChannel(
  channel: LoadedChannel,
  contactId: string,
): Promise<string | null> {
  const db = supabaseAdmin()
  const ws = channel.workspace_id
  if (channel.type === 'whatsapp') await ensureWhatsAppIdentity(ws, contactId)

  const { data: existing } = await db
    .from('conversations')
    .select('id')
    .eq('workspace_id', ws)
    .eq('contact_id', contactId)
    .eq('channel_id', channel.id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (existing) return existing.id

  const { data: legacy } = await db
    .from('conversations')
    .select('id')
    .eq('workspace_id', ws)
    .eq('contact_id', contactId)
    .is('channel_id', null)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (legacy) {
    await db.from('conversations').update({ channel_id: channel.id }).eq('id', legacy.id)
    return legacy.id
  }

  const { data: created, error } = await db
    .from('conversations')
    .insert({ workspace_id: ws, contact_id: contactId, channel_id: channel.id })
    .select('id')
    .single()
  if (error || !created) {
    console.error('[conversations] conversation insert failed:', error?.message)
    return null
  }
  return created.id
}

/**
 * Conversation to reach a contact on: their most recently active
 * conversation (any channel), else one on the workspace's default
 * WhatsApp channel. Null when neither is possible.
 */
export async function conversationForContact(workspaceId: string, contactId: string): Promise<string | null> {
  const { data: latest } = await supabaseAdmin()
    .from('conversations')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('contact_id', contactId)
    .not('channel_id', 'is', null)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle()
  if (latest) return latest.id

  const channel = await defaultChannel(workspaceId, 'whatsapp')
  if (!channel) return null
  return findOrCreateConversationOnChannel(channel, contactId)
}

/**
 * Bot/agent message to a contact on their usual conversation (see
 * conversationForContact). Never throws for delivery problems: they come
 * back as status 'failed' like sendMessage().
 */
export async function sendToContact(input: {
  workspaceId: string
  contactId: string
  content: OutboundContent
  sender?: SendMessageInput['sender']
  metadata?: Record<string, unknown>
}): Promise<SendMessageResult & { conversationId: string | null }> {
  const conversationId = await conversationForContact(input.workspaceId, input.contactId)
  if (!conversationId) {
    return {
      conversationId: null,
      messageId: '',
      externalId: null,
      status: 'failed',
      error: 'No WhatsApp channel connected for this workspace',
    }
  }
  const result = await sendMessage({
    workspaceId: input.workspaceId,
    conversationId,
    content: input.content,
    sender: input.sender ?? { type: 'bot' },
    metadata: input.metadata,
  })
  return { ...result, conversationId }
}

import 'server-only'
import { tenantDb } from '@/lib/db/tenant'
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
  const db = tenantDb(workspaceId)
  const digits = normalizePhone(phone)
  if (!digits) return null

  const exact = await db.contacts.findFirst({ where: { phone: { in: [`+${digits}`, digits, phone] } }, select: { id: true } })
  if (exact) return exact.id

  const candidates = await db.contacts.findMany({ where: { phone: { not: null } }, select: { id: true, phone: true } })
  const match = candidates.find((c) => phonesMatch(c.phone ?? '', digits))
  if (match) return match.id

  try {
    const created = await db.contacts.create({
      data: { workspace_id: workspaceId, name: name || `+${digits}`, phone: `+${digits}` },
      select: { id: true },
    })
    return created.id
  } catch (error) {
    console.error('[conversations] contact insert failed:', error instanceof Error ? error.message : error)
    return null
  }
}

/** Best-effort WhatsApp identity (wa id = phone digits) for a contact. */
async function ensureWhatsAppIdentity(workspaceId: string, contactId: string) {
  const db = tenantDb(workspaceId)
  const existing = await db.contact_identities.findFirst({
    where: { contact_id: contactId, channel_type: 'whatsapp' },
    select: { id: true },
  })
  if (existing) return
  const contact = await db.contacts.findFirst({ where: { id: contactId }, select: { phone: true } })
  const digits = normalizePhone(contact?.phone ?? '')
  if (!digits) return
  // A unique violation means another contact already owns this number on
  // WhatsApp; sendMessage falls back to the contact's phone anyway.
  try {
    await db.contact_identities.create({
      data: {
        workspace_id: workspaceId,
        contact_id: contactId,
        channel_type: 'whatsapp',
        external_id: digits,
        handle: digits,
      },
    })
  } catch {
    // ignored, as before
  }
}

/**
 * Conversation of a contact on a channel; adopts a legacy conversation
 * without channel, or creates one.
 */
export async function findOrCreateConversationOnChannel(
  channel: LoadedChannel,
  contactId: string,
): Promise<string | null> {
  const ws = channel.workspace_id
  const db = tenantDb(ws)
  if (channel.type === 'whatsapp') await ensureWhatsAppIdentity(ws, contactId)

  const existing = await db.conversations.findFirst({
    where: { contact_id: contactId, channel_id: channel.id },
    select: { id: true },
    orderBy: { created_at: 'asc' },
  })
  if (existing) return existing.id

  const legacy = await db.conversations.findFirst({
    where: { contact_id: contactId, channel_id: null },
    select: { id: true },
    orderBy: { created_at: 'asc' },
  })
  if (legacy) {
    await db.conversations.updateMany({ where: { id: legacy.id }, data: { channel_id: channel.id } })
    return legacy.id
  }

  try {
    const created = await db.conversations.create({
      data: { workspace_id: ws, contact_id: contactId, channel_id: channel.id },
      select: { id: true },
    })
    return created.id
  } catch (error) {
    console.error('[conversations] conversation insert failed:', error instanceof Error ? error.message : error)
    return null
  }
}

/**
 * Conversation to reach a contact on: their most recently active
 * conversation (any channel), else one on the workspace's default
 * WhatsApp channel. Null when neither is possible.
 */
export async function conversationForContact(workspaceId: string, contactId: string): Promise<string | null> {
  const latest = await tenantDb(workspaceId).conversations.findFirst({
    where: { contact_id: contactId, channel_id: { not: null } },
    select: { id: true },
    orderBy: { last_message_at: { sort: 'desc', nulls: 'last' } },
  })
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

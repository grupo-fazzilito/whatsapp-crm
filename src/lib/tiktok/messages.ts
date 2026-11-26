import 'server-only'
import { findChannelByExternalId } from '@/lib/channels/store'
import type { InboundEvent, InboundSender, LoadedChannel } from '@/lib/channels'
import { tenantDb } from '@/lib/db/tenant'
import { findOrCreateContact, ingestEvents } from '@/lib/messaging/ingest'
import { storeEchoes } from '@/lib/messaging/echo'
import { getConversationCustomer } from './api'
import { encodeDmMedia, TT_MEDIA_PREFIX, type TiktokDmEvent } from './model'

// TikTok direct messages → the inbox. A customer is identified by TikTok's
// conversation id (where replies go). Messages the business writes from the
// TikTok app show up too and pause the AI agent, like WhatsApp coexistence.

export async function handleTiktokDirectMessage(ev: TiktokDmEvent): Promise<'ignored' | 'stored'> {
  const channel = await findChannelByExternalId('tiktok', ev.openId)
  if (!channel || channel.status !== 'connected') return 'ignored'
  // Sent by Whasalia itself: already in the inbox.
  if (ev.fromBusiness && ev.source === 'API') return 'ignored'

  const from = await customerFor(channel, ev)
  const content = {
    contentType: ev.contentType,
    text: ev.text,
    mediaUrl: ev.mediaId
      ? TT_MEDIA_PREFIX + encodeDmMedia({ conversationId: ev.conversationId, messageId: ev.messageId, mediaId: ev.mediaId, mediaType: ev.contentType === 'video' ? 'VIDEO' : 'IMAGE' })
      : null,
    interactiveReplyId: null,
  }

  if (ev.fromBusiness) {
    await findOrCreateContact(channel, from)
    await storeEchoes(channel, [{ externalMessageId: ev.messageId, customer: ev.conversationId, fromBusiness: true, timestamp: ev.timestamp, content }])
    return 'stored'
  }

  const event: InboundEvent = {
    kind: 'message',
    channelExternalId: channel.external_id,
    from,
    externalMessageId: ev.messageId,
    timestamp: ev.timestamp,
    ...content,
  }
  await ingestEvents(channel, [event])
  return 'stored'
}

/** The customer as the inbox knows them; their TikTok nickname is looked up once, for new contacts. */
async function customerFor(channel: LoadedChannel, ev: TiktokDmEvent): Promise<InboundSender> {
  const handle = ev.customerUsername ? `@${ev.customerUsername.replace(/^@/, '')}` : null
  const known = await tenantDb(channel.workspace_id).contact_identities.findFirst({
    where: { channel_type: 'tiktok', external_id: ev.conversationId },
    select: { contact_id: true },
  })
  if (known) return { externalId: ev.conversationId, handle }
  let name: string | null = null
  try {
    name = (await getConversationCustomer(channel, ev.conversationId))?.displayName ?? null
  } catch (err) {
    console.warn('[tiktok] customer lookup failed:', err instanceof Error ? err.message : err)
  }
  return { externalId: ev.conversationId, name, handle }
}

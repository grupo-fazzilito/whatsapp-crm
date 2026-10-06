import type { InboundEvent } from '../types'

interface MessagingEvent {
  sender: { id: string }
  recipient: { id: string }
  timestamp: number
  message?: {
    mid: string
    text?: string
    is_echo?: boolean
    is_deleted?: boolean
    quick_reply?: { payload: string }
    reply_to?: { mid?: string }
    attachments?: { type: string; payload?: { url?: string; title?: string; coordinates?: { lat: number; long: number } } }[]
  }
  postback?: { mid?: string; title?: string; payload: string }
  delivery?: { mids?: string[]; watermark: number }
  read?: { watermark: number; mid?: string }
  reaction?: { mid: string; action: 'react' | 'unreact'; emoji?: string; reaction?: string }
}

export interface MetaMessagingBody {
  object?: 'page' | 'instagram' | string
  entry?: { id: string; time: number; messaging?: MessagingEvent[] }[]
}

const ATTACHMENT_TYPE: Record<string, 'image' | 'video' | 'audio' | 'document' | 'location'> = {
  image: 'image',
  video: 'video',
  audio: 'audio',
  file: 'document',
  location: 'location',
}

/**
 * Messenger (object=page) and Instagram (object=instagram) webhooks →
 * normalized events. `entry.id` is the page id / Instagram account id,
 * which is the channel's external_id. Echoes of our own sends are skipped.
 */
export function parseMetaMessagingWebhook(body: MetaMessagingBody): InboundEvent[] {
  const events: InboundEvent[] = []
  for (const entry of body.entry ?? []) {
    const channelExternalId = entry.id
    for (const ev of entry.messaging ?? []) {
      const from = { externalId: ev.sender.id }
      const timestamp = ev.timestamp

      if (ev.reaction) {
        events.push({
          kind: 'reaction',
          channelExternalId,
          from,
          targetExternalId: ev.reaction.mid,
          emoji: ev.reaction.action === 'unreact' ? null : ev.reaction.emoji ?? ev.reaction.reaction ?? null,
          timestamp,
        })
        continue
      }

      if (ev.postback) {
        events.push({
          kind: 'message',
          channelExternalId,
          from,
          externalMessageId: ev.postback.mid ?? `postback-${ev.sender.id}-${timestamp}`,
          timestamp,
          contentType: 'interactive',
          text: ev.postback.title ?? ev.postback.payload,
          interactiveReplyId: ev.postback.payload,
        })
        continue
      }

      if (ev.delivery?.mids) {
        for (const mid of ev.delivery.mids) {
          events.push({ kind: 'status', channelExternalId, externalMessageId: mid, status: 'delivered', timestamp })
        }
        continue
      }

      const msg = ev.message
      if (!msg || msg.is_echo || msg.is_deleted) continue

      const base = {
        kind: 'message' as const,
        channelExternalId,
        from,
        externalMessageId: msg.mid,
        timestamp,
        replyToExternalId: msg.reply_to?.mid ?? null,
      }

      if (msg.quick_reply) {
        events.push({
          ...base,
          contentType: 'interactive',
          text: msg.text ?? msg.quick_reply.payload,
          interactiveReplyId: msg.quick_reply.payload,
        })
        continue
      }

      const att = msg.attachments?.[0]
      if (att) {
        const type = ATTACHMENT_TYPE[att.type]
        if (type === 'location' && att.payload?.coordinates) {
          const c = att.payload.coordinates
          events.push({ ...base, contentType: 'location', text: [att.payload.title, `${c.lat},${c.long}`].filter(Boolean).join(' - ') })
        } else if (type) {
          events.push({ ...base, contentType: type, text: msg.text ?? null, mediaUrl: att.payload?.url ?? null })
        } else {
          events.push({ ...base, contentType: 'text', text: msg.text ?? att.payload?.url ?? `[${att.type}]` })
        }
        continue
      }

      events.push({ ...base, contentType: 'text', text: msg.text ?? '' })
    }
  }
  return events
}

import { normalizePhone } from '@/lib/whatsapp/phone-utils'
import type { InboundEvent } from '../types'

interface WaMedia {
  id: string
  mime_type?: string
  caption?: string
  filename?: string
}

interface WaMessage {
  from: string
  id: string
  timestamp: string
  type: string
  text?: { body: string }
  image?: WaMedia
  video?: WaMedia
  document?: WaMedia
  audio?: WaMedia
  sticker?: WaMedia
  location?: { latitude: number; longitude: number; name?: string; address?: string }
  reaction?: { message_id: string; emoji?: string }
  interactive?: {
    type: string
    button_reply?: { id: string; title: string }
    list_reply?: { id: string; title: string }
  }
  button?: { payload?: string; text?: string }
  context?: { id: string }
}

export interface WaWebhookBody {
  object?: string
  entry?: {
    id: string
    changes?: {
      field: string
      value: {
        metadata?: { phone_number_id: string; display_phone_number?: string }
        contacts?: { profile?: { name?: string }; wa_id: string }[]
        messages?: WaMessage[]
        statuses?: { id: string; status: string; timestamp: string; errors?: { title?: string; message?: string }[] }[]
      }
    }[]
  }[]
}

/** Inbound media is fetched lazily through our proxy (needs the channel token). */
export function waMediaProxyUrl(channelId: string, mediaId: string): string {
  return `/api/media/${channelId}/${mediaId}`
}

const STATUS = new Set(['sent', 'delivered', 'read', 'failed'])

/**
 * WhatsApp Cloud API webhook → normalized events. Media URLs are left as
 * `wa-media:<id>` placeholders; ingest rewrites them once the channel id
 * is known (see waMediaProxyUrl).
 */
export function parseWhatsAppWebhook(body: WaWebhookBody): InboundEvent[] {
  const events: InboundEvent[] = []
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value
      const channelExternalId = value?.metadata?.phone_number_id
      if (!channelExternalId) continue

      for (const s of value.statuses ?? []) {
        if (!STATUS.has(s.status)) continue
        events.push({
          kind: 'status',
          channelExternalId,
          externalMessageId: s.id,
          status: s.status as 'sent' | 'delivered' | 'read' | 'failed',
          timestamp: parseInt(s.timestamp, 10) * 1000,
          error: s.errors?.[0]?.message ?? s.errors?.[0]?.title ?? null,
        })
      }

      for (const m of value.messages ?? []) {
        const profile = value.contacts?.find((c) => c.wa_id === m.from) ?? value.contacts?.[0]
        const phone = normalizePhone(m.from)
        const from = { externalId: m.from.replace(/\D/g, ''), name: profile?.profile?.name ?? null, handle: phone, phone }
        const timestamp = parseInt(m.timestamp, 10) * 1000

        if (m.type === 'reaction' && m.reaction?.message_id) {
          events.push({
            kind: 'reaction',
            channelExternalId,
            from: { externalId: from.externalId },
            targetExternalId: m.reaction.message_id,
            emoji: m.reaction.emoji || null,
            timestamp,
          })
          continue
        }

        const base = {
          kind: 'message' as const,
          channelExternalId,
          from,
          externalMessageId: m.id,
          timestamp,
          replyToExternalId: m.context?.id ?? null,
        }
        const media = (x: WaMedia | undefined) => (x?.id ? `wa-media:${x.id}` : null)

        switch (m.type) {
          case 'text':
            events.push({ ...base, contentType: 'text', text: m.text?.body ?? '' })
            break
          case 'image':
          case 'video':
          case 'document':
          case 'audio':
          case 'sticker': {
            const x = m[m.type]
            events.push({
              ...base,
              contentType: m.type,
              text: x?.caption ?? (m.type === 'document' ? x?.filename ?? null : null),
              mediaUrl: media(x),
            })
            break
          }
          case 'location': {
            const l = m.location
            const text = l ? [l.name, l.address, `${l.latitude},${l.longitude}`].filter(Boolean).join(' - ') : null
            events.push({ ...base, contentType: 'location', text })
            break
          }
          case 'interactive': {
            const reply = m.interactive?.button_reply ?? m.interactive?.list_reply
            events.push({
              ...base,
              contentType: 'interactive',
              text: reply?.title ?? reply?.id ?? '[Interactive reply]',
              interactiveReplyId: reply?.id ?? null,
            })
            break
          }
          case 'button':
            // Quick-reply button on a template message.
            events.push({
              ...base,
              contentType: 'interactive',
              text: m.button?.text ?? m.button?.payload ?? '',
              interactiveReplyId: m.button?.payload ?? null,
            })
            break
          default:
            events.push({ ...base, contentType: 'text', text: `[Unsupported message type: ${m.type}]` })
        }
      }
    }
  }
  return events
}

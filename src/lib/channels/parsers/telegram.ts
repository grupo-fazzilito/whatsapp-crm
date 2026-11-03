// Telegram Bot API webhook updates → normalized inbound events.
// https://core.telegram.org/bots/api#update
//
// Only private chats with people are handled: groups, channels and other
// bots are ignored. Message ids are only unique inside a chat, so they are
// stored as "<chat id>_<message id>".
import type { InboundEvent } from '../types'

interface TgUser {
  id: number
  is_bot?: boolean
  first_name?: string
  last_name?: string
  username?: string
}

interface TgChat {
  id: number
  type: string
}

interface TgFile {
  file_id: string
  file_name?: string
  mime_type?: string
}

export interface TgMessage {
  message_id: number
  from?: TgUser
  chat: TgChat
  date: number
  text?: string
  caption?: string
  photo?: TgFile[]
  video?: TgFile
  video_note?: TgFile
  animation?: TgFile
  voice?: TgFile
  audio?: TgFile
  document?: TgFile
  sticker?: TgFile & { emoji?: string }
  location?: { latitude: number; longitude: number }
  venue?: { location: { latitude: number; longitude: number }; title?: string; address?: string }
  contact?: { phone_number: string; first_name?: string; user_id?: number }
  reply_to_message?: { message_id: number }
  reply_markup?: { inline_keyboard?: { text: string; callback_data?: string }[][] }
}

export interface TgUpdate {
  update_id: number
  message?: TgMessage
  callback_query?: {
    id: string
    from: TgUser
    message?: TgMessage
    data?: string
  }
}

/** Stored id of a Telegram message (ids repeat across chats). */
export function tgMessageKey(chatId: number | string, messageId: number | string): string {
  return `${chatId}_${messageId}`
}

/** "<chat>_<message>" → its parts; null for anything else. */
export function parseTgMessageKey(key: string | null | undefined): { chatId: string; messageId: number } | null {
  const m = /^(-?\d+)_(\d+)$/.exec(key ?? '')
  return m ? { chatId: m[1], messageId: Number(m[2]) } : null
}

/** Placeholder for an inbound file; ingest turns it into the media proxy URL. */
export const TG_FILE_PREFIX = 'tg-file:'

function sender(u: TgUser, phone?: string | null): Extract<InboundEvent, { kind: 'message' }>['from'] {
  const name = [u.first_name, u.last_name].map((s) => s?.trim()).filter(Boolean).join(' ') || null
  return {
    externalId: String(u.id),
    name,
    handle: u.username ? `@${u.username}` : null,
    ...(phone ? { phone } : {}),
  }
}

/** Telegram sends "+51 987…" or "51987…": keep the digits. */
function phoneDigits(raw: string): string | null {
  const d = raw.replace(/\D/g, '')
  return d.length >= 6 ? d : null
}

type Content = Pick<Extract<InboundEvent, { kind: 'message' }>, 'contentType' | 'text' | 'mediaUrl'>

function messageContent(m: TgMessage): Content {
  const file = (f: TgFile | undefined) => (f?.file_id ? `${TG_FILE_PREFIX}${f.file_id}` : null)
  const caption = m.caption ?? null
  if (m.photo?.length) return { contentType: 'image', text: caption, mediaUrl: file(m.photo[m.photo.length - 1]) }
  if (m.video) return { contentType: 'video', text: caption, mediaUrl: file(m.video) }
  if (m.video_note) return { contentType: 'video', text: null, mediaUrl: file(m.video_note) }
  // GIFs come as animation (with a document copy): show them as video.
  if (m.animation) return { contentType: 'video', text: caption, mediaUrl: file(m.animation) }
  if (m.voice) return { contentType: 'audio', text: null, mediaUrl: file(m.voice) }
  if (m.audio) return { contentType: 'audio', text: caption, mediaUrl: file(m.audio) }
  if (m.document) return { contentType: 'document', text: caption ?? m.document.file_name ?? null, mediaUrl: file(m.document) }
  if (m.sticker) return { contentType: 'sticker', text: m.sticker.emoji ?? null, mediaUrl: file(m.sticker) }
  if (m.venue) {
    const l = m.venue.location
    return { contentType: 'location', text: [m.venue.title, m.venue.address, `${l.latitude},${l.longitude}`].filter(Boolean).join(' - ') }
  }
  if (m.location) return { contentType: 'location', text: `${m.location.latitude},${m.location.longitude}` }
  if (m.contact) return { contentType: 'text', text: `📱 +${phoneDigits(m.contact.phone_number) ?? m.contact.phone_number}` }
  if (typeof m.text === 'string') return { contentType: 'text', text: m.text }
  return { contentType: 'text', text: '[Unsupported message]' }
}

/** Callback queries the webhook must answer (stops the button's spinner). */
export interface ParsedTelegramUpdate {
  events: InboundEvent[]
  callbackQueryId: string | null
}

/**
 * One update → events for the bot `botId`. A tapped inline button becomes an
 * interactive reply whose id is the button's callback data (hashed ids are
 * resolved later against the message that carried the buttons).
 */
export function parseTelegramUpdate(botId: string, update: TgUpdate): ParsedTelegramUpdate {
  const cb = update.callback_query
  if (cb) {
    const chat = cb.message?.chat
    if (!cb.data || cb.from.is_bot || (chat && chat.type !== 'private')) return { events: [], callbackQueryId: cb.id }
    const button = cb.message?.reply_markup?.inline_keyboard?.flat().find((b) => b.callback_data === cb.data)
    return {
      callbackQueryId: cb.id,
      events: [
        {
          kind: 'message',
          channelExternalId: botId,
          from: sender(cb.from),
          externalMessageId: `cb_${cb.id}`,
          timestamp: Date.now(),
          contentType: 'interactive',
          text: button?.text ?? cb.data,
          interactiveReplyId: cb.data,
          replyToExternalId: cb.message ? tgMessageKey(cb.message.chat.id, cb.message.message_id) : null,
        },
      ],
    }
  }

  const m = update.message
  if (!m || !m.from || m.from.is_bot || m.chat.type !== 'private') return { events: [], callbackQueryId: null }
  // A shared contact card counts as the customer's phone only when it is theirs.
  const ownPhone = m.contact && m.contact.user_id === m.from.id ? phoneDigits(m.contact.phone_number) : null
  return {
    callbackQueryId: null,
    events: [
      {
        kind: 'message',
        channelExternalId: botId,
        from: sender(m.from, ownPhone),
        externalMessageId: tgMessageKey(m.chat.id, m.message_id),
        timestamp: m.date * 1000,
        ...messageContent(m),
        replyToExternalId: m.reply_to_message ? tgMessageKey(m.chat.id, m.reply_to_message.message_id) : null,
      },
    ],
  }
}

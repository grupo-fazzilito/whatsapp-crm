// Telegram Bot API (official, free): the business's own bot, created with
// @BotFather. The recipient is the customer's chat id; there is no reply
// window, templates or delivery receipts.
// https://core.telegram.org/bots/api
import crypto from 'node:crypto'
import { parseTgMessageKey, tgMessageKey } from '../parsers/telegram'
import { channelText, stripMarkup } from '../format'
import { ChannelSendError, type ChannelAdapter, type InteractiveOption, type OutboundContent, type SendContext, type SendResult } from '../types'

// Overridable only to point tests at a local stand-in.
export const TELEGRAM_API = process.env.TELEGRAM_API_BASE ?? 'https://api.telegram.org'

/** Button that asks Telegram to share the customer's own phone number. */
export const SHARE_PHONE_ID = 'contact:share_phone'

const CALLBACK_DATA_MAX = 64
const CAPTION_MAX = 1024

/** "123456:ABC…" as BotFather gives it. */
export function looksLikeBotToken(token: string): boolean {
  return /^\d{5,20}:[A-Za-z0-9_-]{30,64}$/.test(token)
}

/** The bot's numeric id is the part of the token before the colon. */
export function botIdFromToken(token: string): string {
  return token.split(':')[0]
}

/**
 * Button ids longer than Telegram's 64-byte callback data are sent as a
 * short hash; the webhook maps it back using the message that carried them.
 */
export function callbackData(id: string): string {
  if (Buffer.byteLength(id, 'utf8') <= CALLBACK_DATA_MAX) return id
  return `h:${hashOptionId(id)}`
}

export function hashOptionId(id: string): string {
  return crypto.createHash('sha256').update(id).digest('base64url').slice(0, 22)
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** WhatsApp-style *bold* _italic_ ~strike~ ```code``` → Telegram HTML. */
export function toTelegramHtml(text: string): string {
  return escapeHtml(text)
    .replace(/```([\s\S]*?)```/g, '<pre>$1</pre>')
    .replace(/(^|[\s(¡¿"'])\*([^*\n]+?)\*(?=$|[\s).,;:!?"'])/g, '$1<b>$2</b>')
    .replace(/(^|[\s(¡¿"'])_([^_\n]+?)_(?=$|[\s).,;:!?"'])/g, '$1<i>$2</i>')
    .replace(/(^|[\s(¡¿"'])~([^~\n]+?)~(?=$|[\s).,;:!?"'])/g, '$1<s>$2</s>')
}

/** One Bot API call; chat_id and reply parameters are added when sending. */
export interface TgRequest {
  method: string
  body: Record<string, unknown>
  /** Formatted text field: on a parse error it is retried as plain text. */
  html?: { field: 'text' | 'caption'; plain: string }
}

function textRequest(text: string, extra: Record<string, unknown> = {}): TgRequest {
  return { method: 'sendMessage', body: { text: toTelegramHtml(text), parse_mode: 'HTML', ...extra }, html: { field: 'text', plain: stripMarkup(text) } }
}

function texts(text: string): TgRequest[] {
  return channelText('telegram', text).map((t) => textRequest(t))
}

function optionLabel(o: InteractiveOption): string {
  return (o.description ? `${o.title} — ${o.description}` : o.title).slice(0, 64)
}

function keyboard(options: InteractiveOption[]) {
  return { inline_keyboard: options.map((o) => [{ text: optionLabel(o), callback_data: callbackData(o.id) }]) }
}

/** Text with its buttons attached to the last part (long texts are split). */
function withButtons(text: string, options: InteractiveOption[]): TgRequest[] {
  // Asking for the phone uses Telegram's own "share contact" keyboard.
  if (options.length === 1 && options[0].id === SHARE_PHONE_ID) {
    const parts = texts(text)
    const last = parts[parts.length - 1]
    last.body.reply_markup = { keyboard: [[{ text: options[0].title, request_contact: true }]], one_time_keyboard: true, resize_keyboard: true }
    return parts
  }
  const parts = texts(text || '…')
  parts[parts.length - 1].body.reply_markup = keyboard(options)
  return parts
}

const MEDIA_METHOD = { image: ['sendPhoto', 'photo'], video: ['sendVideo', 'video'], audio: ['sendAudio', 'audio'], document: ['sendDocument', 'document'] } as const

/** Calls to make, in order, for one outbound message. */
export function telegramRequests(content: OutboundContent): TgRequest[] {
  switch (content.type) {
    case 'text':
      return texts(content.text)
    case 'media': {
      const [method, field] = MEDIA_METHOD[content.mediaType]
      const caption = content.caption?.trim() ?? ''
      const req: TgRequest = { method, body: { [field]: content.url } }
      if (!caption) return [req]
      // Captions over Telegram's limit go as their own message.
      if (caption.length > CAPTION_MAX) return [req, ...texts(caption)]
      req.body.caption = toTelegramHtml(caption)
      req.body.parse_mode = 'HTML'
      req.html = { field: 'caption', plain: stripMarkup(caption) }
      return [req]
    }
    case 'buttons':
      return withButtons(content.text, content.options)
    case 'list':
      return withButtons(content.text, content.sections.flatMap((s) => s.options))
    case 'carousel':
      return [
        ...(content.text?.trim() ? texts(content.text) : []),
        ...content.cards.slice(0, 10).map((c): TgRequest => {
          const caption = [`*${c.title}*`, c.subtitle].filter(Boolean).join('\n').slice(0, CAPTION_MAX)
          return {
            method: 'sendPhoto',
            body: { photo: c.imageUrl, caption: toTelegramHtml(caption), parse_mode: 'HTML', ...(c.buttons.length ? { reply_markup: keyboard(c.buttons) } : {}) },
            html: { field: 'caption', plain: stripMarkup(caption) },
          }
        }),
      ]
    case 'location': {
      const { latitude, longitude, name, address } = content
      if (name && address) return [{ method: 'sendVenue', body: { latitude, longitude, title: name, address } }]
      return [{ method: 'sendLocation', body: { latitude, longitude } }, ...(name || address ? texts(`📍 ${name || address}`) : [])]
    }
    case 'template':
      throw new ChannelSendError('Templates are only available on WhatsApp', 'unsupported')
  }
}

export class TelegramApiError extends Error {
  constructor(
    message: string,
    readonly errorCode: number | null,
  ) {
    super(message)
    this.name = 'TelegramApiError'
  }
}

/** POST one Bot API method; returns `result` or throws with Telegram's description. */
export async function tgCall<T = unknown>(token: string, method: string, body: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`${TELEGRAM_API}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  })
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string; error_code?: number }
  if (!data.ok) throw new TelegramApiError(data.description ?? `Telegram API error: ${res.status}`, data.error_code ?? res.status)
  return data.result as T
}

async function post(token: string, req: TgRequest, base: Record<string, unknown>): Promise<{ message_id: number }> {
  try {
    return await tgCall<{ message_id: number }>(token, req.method, { ...base, ...req.body })
  } catch (err) {
    // Formatting Telegram can't parse: send the same text without it.
    if (req.html && err instanceof TelegramApiError && /can't parse entities/i.test(err.message)) {
      const { parse_mode: _pm, ...rest } = req.body
      void _pm
      return tgCall<{ message_id: number }>(token, req.method, { ...base, ...rest, [req.html.field]: req.html.plain })
    }
    throw err
  }
}

export const telegramAdapter: ChannelAdapter = {
  type: 'telegram',
  capabilities: { templates: false, reactions: false, interactive: true, replyWindowHours: null, media: true },
  async send(ctx: SendContext, content: OutboundContent): Promise<SendResult> {
    const token = ctx.channel.secrets.access_token
    if (!token) throw new ChannelSendError('Telegram bot token missing', 'not_configured')
    const quoted = parseTgMessageKey(ctx.replyToExternalId)
    let first: string | null = null
    for (const req of telegramRequests(content)) {
      const base: Record<string, unknown> = { chat_id: ctx.recipient }
      if (!first && quoted && quoted.chatId === ctx.recipient) {
        base.reply_parameters = { message_id: quoted.messageId, allow_sending_without_reply: true }
      }
      try {
        const sent = await post(token, req, base)
        first ??= tgMessageKey(ctx.recipient, sent.message_id)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        // A follow-up part failing (caption, a card) must not hide that the main one went out.
        if (first) {
          console.warn('[telegram] extra message part failed:', msg)
          continue
        }
        // 403: the customer blocked the bot or never started it.
        const blocked = err instanceof TelegramApiError && err.errorCode === 403
        throw new ChannelSendError(blocked ? `Telegram: ${msg}` : msg, blocked ? 'unsupported' : 'provider_error')
      }
    }
    return { externalId: first }
  },
}

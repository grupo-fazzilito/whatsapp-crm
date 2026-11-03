import 'server-only'
import crypto from 'node:crypto'
import { tenantDb } from '@/lib/db/tenant'
import { TELEGRAM_API, hashOptionId, tgCall } from './adapters/telegram'
import type { InboundEvent, LoadedChannel } from './types'

export interface TelegramBot {
  id: string
  username: string | null
  firstName: string | null
}

/** Updates the bot receives: messages and taps on inline buttons. */
const ALLOWED_UPDATES = ['message', 'callback_query']

/** Who the token belongs to (getMe). Throws Telegram's error when the token is wrong. */
export async function getBot(token: string): Promise<TelegramBot> {
  const me = await tgCall<{ id: number; is_bot: boolean; username?: string; first_name?: string }>(token, 'getMe')
  if (!me.is_bot) throw new Error('This token is not a bot token')
  return { id: String(me.id), username: me.username ?? null, firstName: me.first_name ?? null }
}

export function newWebhookSecret(): string {
  return crypto.randomBytes(32).toString('hex')
}

export function telegramWebhookUrl(origin: string, botId: string): string {
  return `${origin.replace(/\/+$/, '')}/api/webhooks/telegram/${botId}`
}

/**
 * Points the bot at Whasalia. Telegram signs every update with the secret
 * in X-Telegram-Bot-Api-Secret-Token. Replaces any webhook set by another
 * tool: a bot has only one. Returns the error text, or null when it worked.
 */
export async function setBotWebhook(token: string, url: string, secret: string): Promise<string | null> {
  try {
    await tgCall(token, 'setWebhook', { url, secret_token: secret, allowed_updates: ALLOWED_UPDATES })
    return null
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}

/** Stops Telegram from sending this bot's updates (best effort). */
export async function deleteBotWebhook(token: string): Promise<void> {
  await tgCall(token, 'deleteWebhook').catch(() => null)
}

/** Stops the loading spinner on a tapped button. */
export async function answerCallbackQuery(token: string, id: string): Promise<void> {
  await tgCall(token, 'answerCallbackQuery', { callback_query_id: id }).catch(() => null)
}

export function secretMatches(channel: LoadedChannel, header: string | null): boolean {
  const expected = channel.secrets.webhook_secret
  if (!expected || !header) return false
  const a = Buffer.from(expected)
  const b = Buffer.from(header)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

/** Every option id a stored outbound message offered (buttons, list rows, card buttons). */
function offeredIds(metadata: unknown): string[] {
  const m = (metadata ?? {}) as {
    options?: { id?: string }[]
    sections?: { options?: { id?: string }[] }[]
    cards?: { buttons?: { id?: string }[] }[]
  }
  return [
    ...(m.options ?? []),
    ...(m.sections ?? []).flatMap((s) => s.options ?? []),
    ...(m.cards ?? []).flatMap((c) => c.buttons ?? []),
  ]
    .map((o) => o.id)
    .filter((id): id is string => typeof id === 'string')
}

/**
 * Button taps carry "h:<hash>" when the real id didn't fit in Telegram's 64
 * bytes: look it up in the message that showed the buttons.
 */
export async function resolveHashedReplies(channel: LoadedChannel, events: InboundEvent[]): Promise<InboundEvent[]> {
  const db = tenantDb(channel.workspace_id)
  const out: InboundEvent[] = []
  for (const ev of events) {
    if (ev.kind !== 'message' || !ev.interactiveReplyId?.startsWith('h:') || !ev.replyToExternalId) {
      out.push(ev)
      continue
    }
    const hash = ev.interactiveReplyId.slice(2)
    const rows = await db.messages
      .findMany({
        where: { message_id: ev.replyToExternalId, conversations: { channel_id: channel.id } },
        select: { metadata: true },
        take: 5,
      })
      .catch(() => [])
    const id = rows.flatMap((r) => offeredIds(r.metadata)).find((x) => hashOptionId(x) === hash)
    out.push({ ...ev, interactiveReplyId: id ?? null })
  }
  return out
}

const EXT_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  oga: 'audio/ogg',
  ogg: 'audio/ogg',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  pdf: 'application/pdf',
  tgs: 'application/x-tgsticker',
}

/** Bytes of a file a customer sent (Bot API downloads are capped at 20 MB). */
export async function downloadTelegramFile(token: string, fileId: string, maxBytes: number): Promise<{ bytes: Uint8Array; contentType: string }> {
  const file = await tgCall<{ file_path?: string; file_size?: number }>(token, 'getFile', { file_id: fileId })
  if (!file.file_path) throw new Error('Telegram file not available')
  if (file.file_size && file.file_size > maxBytes) throw new Error('Media too large')
  const res = await fetch(`${TELEGRAM_API}/file/bot${token}/${file.file_path}`, { signal: AbortSignal.timeout(30_000) })
  if (!res.ok) throw new Error(`Telegram file download failed: ${res.status}`)
  const buf = new Uint8Array(await res.arrayBuffer())
  if (buf.byteLength > maxBytes) throw new Error('Media too large')
  const ext = file.file_path.split('.').pop()?.toLowerCase() ?? ''
  const header = res.headers.get('content-type')
  const contentType = EXT_MIME[ext] ?? (header && header !== 'application/octet-stream' ? header : 'application/octet-stream')
  return { bytes: buf, contentType }
}

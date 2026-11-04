import 'server-only'
import crypto from 'node:crypto'
import type { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/db/prisma'
import { tenantDb } from '@/lib/db/tenant'
import { TELEGRAM_API, hashOptionId, tgCall } from './adapters/telegram'
import { businessChannelKey, type TgBusinessConnection } from './parsers/telegram'
import { findChannelByExternalId, saveChannelSecrets } from './store'
import type { InboundEvent, LoadedChannel } from './types'

export interface TelegramBot {
  id: string
  username: string | null
  firstName: string | null
}

/** Updates the bot receives: messages, taps on inline buttons and Telegram Business. */
const ALLOWED_UPDATES = ['message', 'callback_query', 'business_connection', 'business_message']

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

// ------------------------------------------------------------
// Telegram Business: the bot answers the owner's personal account
// ------------------------------------------------------------

/** Name of the channel created for a connected business account. */
const BUSINESS_CHANNEL_NAME = { es: 'Cuenta personal', en: 'Personal account' }

/**
 * The owner added (or removed / changed) the bot in Telegram → Telegram
 * Business → Chatbots. Their account becomes its own channel in the bot's
 * workspace, sending through the bot's token with the connection id.
 */
export async function applyBusinessConnection(bot: LoadedChannel, conn: TgBusinessConnection): Promise<void> {
  const key = businessChannelKey(bot.external_id, conn.id)
  const canReply = conn.rights?.can_reply ?? conn.can_reply ?? false
  const username = conn.user.username ?? null
  const ownerName = [conn.user.first_name, conn.user.last_name].filter(Boolean).join(' ') || null
  const settings = {
    mode: 'business',
    bot_channel_id: bot.id,
    bot_id: bot.external_id,
    business_connection_id: conn.id,
    owner_id: String(conn.user.id),
    owner_name: ownerName,
    username,
    can_reply: canReply,
  }
  const status = conn.is_enabled ? 'connected' : 'disconnected'
  const statusDetail = conn.is_enabled && !canReply ? 'reply_not_allowed' : null
  const existing = await findChannelByExternalId('telegram', key)
  if (existing && existing.workspace_id !== bot.workspace_id) return
  const db = tenantDb(bot.workspace_id)
  if (existing) {
    await db.channels.updateMany({
      where: { id: existing.id },
      data: {
        status,
        status_detail: statusDetail,
        display_handle: username ? `@${username}` : ownerName,
        settings: { ...existing.settings, ...settings } as Prisma.InputJsonValue,
        updated_at: new Date(),
      },
    })
    return
  }
  if (!conn.is_enabled) return
  const ws = await prisma.workspaces.findUnique({ where: { id: bot.workspace_id }, select: { locale: true } })
  const created = await db.channels.create({
    data: {
      workspace_id: bot.workspace_id,
      type: 'telegram',
      name: BUSINESS_CHANNEL_NAME[ws?.locale === 'en' ? 'en' : 'es'],
      external_id: key,
      display_handle: username ? `@${username}` : ownerName,
      status,
      status_detail: statusDetail,
      settings: settings as Prisma.InputJsonValue,
      // Same AI agent as the bot to start with; changeable on its card.
      ai_agent_id: bot.ai_agent_id,
      created_by: null,
    },
    select: { id: true },
  })
  if (bot.secrets.access_token) await saveChannelSecrets(created.id, { access_token: bot.secrets.access_token })
}

/** Business-account channels that send through this bot. */
export async function linkedBusinessChannels(bot: { id: string; workspace_id: string }): Promise<{ id: string }[]> {
  return tenantDb(bot.workspace_id).channels.findMany({
    where: { type: 'telegram', settings: { path: ['bot_channel_id'], equals: bot.id } },
    select: { id: true },
  })
}

/** Points the bot at Whasalia again (new allowed updates), keeping its secret. */
export async function resyncBotWebhook(bot: LoadedChannel, url: string): Promise<string | null> {
  const token = bot.secrets.access_token
  const secret = bot.secrets.webhook_secret
  if (!token || !secret) return 'missing credentials'
  return setBotWebhook(token, url, secret)
}

/** A business connection by id (getBusinessConnection), or null. */
export async function fetchBusinessConnection(bot: LoadedChannel, connectionId: string): Promise<TgBusinessConnection | null> {
  const token = bot.secrets.access_token
  if (!token || !/^[A-Za-z0-9_-]{1,128}$/.test(connectionId)) return null
  return tgCall<TgBusinessConnection>(token, 'getBusinessConnection', { business_connection_id: connectionId }).catch(() => null)
}

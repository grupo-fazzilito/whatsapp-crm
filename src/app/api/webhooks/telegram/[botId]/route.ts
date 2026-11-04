import { NextResponse, after } from 'next/server'
import { findChannelByExternalId } from '@/lib/channels/store'
import { parseTelegramUpdate, type TgUpdate } from '@/lib/channels/parsers/telegram'
import { answerCallbackQuery, applyBusinessConnection, fetchBusinessConnection, resolveHashedReplies, secretMatches } from '@/lib/channels/telegram-server'
import { findOrCreateContact, ingestEvents } from '@/lib/messaging/ingest'
import { storeEchoes } from '@/lib/messaging/echo'
import type { InboundEvent, LoadedChannel } from '@/lib/channels'

/**
 * POST /api/webhooks/telegram/{botId}
 *
 * Updates of one business's bot. Whasalia sets this URL with setWebhook when
 * the bot is connected, with a random secret Telegram sends back in
 * X-Telegram-Bot-Api-Secret-Token on every update. With Telegram Business
 * the same bot also brings the messages of the owner's personal account,
 * which is its own channel ("<bot id>:<connection id>").
 */
export async function POST(request: Request, { params }: { params: Promise<{ botId: string }> }) {
  const { botId } = await params
  if (!/^\d{1,20}$/.test(botId)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const bot = await findChannelByExternalId('telegram', botId)
  if (!bot || !secretMatches(bot, request.headers.get('x-telegram-bot-api-secret-token'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const update = (await request.json().catch(() => null)) as TgUpdate | null
  if (!update || typeof update !== 'object') return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const { events, callbackQueryId, connection, echo } = parseTelegramUpdate(botId, update)
  const token = bot.secrets.access_token
  if (callbackQueryId && token) after(() => answerCallbackQuery(token, callbackQueryId))

  // Ack right away (Telegram retries slow answers); process after the response.
  after(async () => {
    try {
      if (connection) await applyBusinessConnection(bot, connection)
      if (echo) {
        const channel = await channelFor(bot, echo.channelExternalId)
        if (channel) {
          // The customer's name comes with the chat, not with the owner's message.
          const chat = update.business_message?.chat as { first_name?: string; last_name?: string; username?: string } | undefined
          const name = [chat?.first_name, chat?.last_name].filter(Boolean).join(' ') || null
          await findOrCreateContact(channel, { externalId: echo.message.customer, name, handle: chat?.username ? `@${chat.username}` : null })
          await storeEchoes(channel, [echo.message])
        }
      }
      const byChannel = new Map<string, InboundEvent[]>()
      for (const ev of events) byChannel.set(ev.channelExternalId, [...(byChannel.get(ev.channelExternalId) ?? []), ev])
      for (const [externalId, list] of byChannel) {
        const channel = await channelFor(bot, externalId)
        if (!channel) continue
        await ingestEvents(channel, await resolveHashedReplies(channel, list))
      }
    } catch (err) {
      console.error('[telegram] update failed:', err)
    }
  })
  return NextResponse.json({ ok: true })
}

/** The bot itself, or one of its business-account channels (same workspace only). */
async function channelFor(bot: LoadedChannel, externalId: string): Promise<LoadedChannel | null> {
  if (externalId === bot.external_id) return bot
  let channel = await findChannelByExternalId('telegram', externalId)
  // Connected before the bot listened to Business updates: ask Telegram for the connection.
  if (!channel && externalId.startsWith(`${bot.external_id}:`)) {
    const conn = await fetchBusinessConnection(bot, externalId.slice(bot.external_id.length + 1))
    if (conn) {
      await applyBusinessConnection(bot, conn)
      channel = await findChannelByExternalId('telegram', externalId)
    }
  }
  if (!channel || channel.workspace_id !== bot.workspace_id) {
    console.warn(`[telegram] no business channel ${externalId}; ignoring`)
    return null
  }
  return channel
}

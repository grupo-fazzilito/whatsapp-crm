import { NextResponse, after } from 'next/server'
import { findChannelByExternalId } from '@/lib/channels/store'
import { parseTelegramUpdate, type TgUpdate } from '@/lib/channels/parsers/telegram'
import { answerCallbackQuery, resolveHashedReplies, secretMatches } from '@/lib/channels/telegram-server'
import { ingestEvents } from '@/lib/messaging/ingest'

/**
 * POST /api/webhooks/telegram/{botId}
 *
 * Updates of one business's bot. Whasalia sets this URL with setWebhook when
 * the bot is connected, with a random secret Telegram sends back in
 * X-Telegram-Bot-Api-Secret-Token on every update.
 */
export async function POST(request: Request, { params }: { params: Promise<{ botId: string }> }) {
  const { botId } = await params
  if (!/^\d{1,20}$/.test(botId)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const channel = await findChannelByExternalId('telegram', botId)
  if (!channel || !secretMatches(channel, request.headers.get('x-telegram-bot-api-secret-token'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const update = (await request.json().catch(() => null)) as TgUpdate | null
  if (!update || typeof update !== 'object') return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const { events, callbackQueryId } = parseTelegramUpdate(botId, update)
  const token = channel.secrets.access_token
  if (callbackQueryId && token) after(() => answerCallbackQuery(token, callbackQueryId))
  if (events.length > 0) {
    // Ack right away (Telegram retries slow answers); process after the response.
    after(async () => {
      try {
        await ingestEvents(channel, await resolveHashedReplies(channel, events))
      } catch (err) {
        console.error('[telegram] ingest failed:', err)
      }
    })
  }
  return NextResponse.json({ ok: true })
}

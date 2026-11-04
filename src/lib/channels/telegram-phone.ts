import 'server-only'
import { tenantDb } from '@/lib/db/tenant'
import { sendMessage } from '@/lib/messaging/send'
import { SHARE_PHONE_ID, businessConnectionId } from './adapters/telegram'

const TEXT = {
  es: { ask: 'Para coordinar contigo, ¿nos compartes tu número? Toca el botón de abajo.', button: '📱 Compartir mi número' },
  en: { ask: 'So we can reach you, would you share your phone number? Tap the button below.', button: '📱 Share my number' },
}

/**
 * Telegram never gives us the customer's phone. After an order or a
 * booking made in the chat, the bot offers Telegram's "share contact"
 * button once, if the contact has no phone yet. Other channels: no-op.
 */
export async function askTelegramPhone(input: { workspaceId: string; conversationId: string; lang: 'es' | 'en'; aiAgentId?: string | null }) {
  const db = tenantDb(input.workspaceId)
  const conv = await db.conversations
    .findFirst({ where: { id: input.conversationId }, select: { channels: { select: { type: true, settings: true } }, contacts: { select: { phone: true } } } })
    .catch(() => null)
  if (conv?.channels?.type !== 'telegram' || conv.contacts?.phone) return
  // Telegram Business: the share-contact button can't be sent from a personal account.
  if (businessConnectionId(conv.channels.settings as Record<string, unknown>)) return
  const t = TEXT[input.lang] ?? TEXT.es
  await sendMessage({
    workspaceId: input.workspaceId,
    conversationId: input.conversationId,
    content: { type: 'buttons', text: t.ask, options: [{ id: SHARE_PHONE_ID, title: t.button }] },
    sender: { type: 'bot', ...(input.aiAgentId ? { aiAgentId: input.aiAgentId } : {}) },
    metadata: { source: 'telegram_phone' },
  }).catch((err) => console.error('[telegram] phone request failed:', err instanceof Error ? err.message : err))
}

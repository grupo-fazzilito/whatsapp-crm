import 'server-only'
import type { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/db/prisma'
import { tenantDb } from '@/lib/db/tenant'
import { loadChannel } from '@/lib/channels/store'
import type { LoadedChannel } from '@/lib/channels/types'
import { fetchMarketingStatus, marketingStateStale, readMarketingState, type MarketingState } from './marketing'

/**
 * Asks Meta whether the channel's account can use the Marketing Messages
 * API and stores the answer in channels.settings.marketing_messages.
 * Returns the stored state (the previous one if Meta can't be asked).
 */
export async function refreshMarketingState(channel: LoadedChannel): Promise<MarketingState | null> {
  const previous = readMarketingState(channel.settings)
  const wabaId = typeof channel.settings?.waba_id === 'string' ? channel.settings.waba_id : ''
  const token = channel.secrets.access_token
  if (channel.type !== 'whatsapp' || !wabaId || !token) return previous
  let state: MarketingState
  try {
    state = { status: await fetchMarketingStatus(wabaId, token), checked_at: new Date().toISOString() }
  } catch (err) {
    console.warn('[marketing] status check failed:', err instanceof Error ? err.message : err)
    return previous
  }
  // Re-read so a concurrent settings change isn't overwritten.
  const db = tenantDb(channel.workspace_id)
  const row = await db.channels.findFirst({ where: { id: channel.id }, select: { settings: true } })
  const settings: Record<string, unknown> = { ...((row?.settings as Record<string, unknown>) ?? {}), marketing_messages: { ...state } }
  await db.channels.updateMany({ where: { id: channel.id }, data: { settings: settings as Prisma.InputJsonObject } })
  channel.settings = settings
  return state
}

/** Checks again only when the stored answer is missing or old (before sending a marketing template). */
export async function ensureMarketingState(channel: LoadedChannel): Promise<MarketingState | null> {
  const state = readMarketingState(channel.settings)
  return marketingStateStale(state) ? refreshMarketingState(channel) : state
}

/** `account_update` MM_LITE_TERMS_SIGNED: the business accepted the terms; check its numbers again. */
export async function applyMarketingTermsSigned(wabaIds: string[]): Promise<void> {
  for (const wabaId of wabaIds) {
    // Platform lookup: the webhook only names the account.
    const rows = await prisma.channels.findMany({
      where: { type: 'whatsapp', settings: { path: ['waba_id'], equals: wabaId } },
      select: { id: true, workspace_id: true },
    })
    for (const r of rows) {
      const channel = await loadChannel(r.workspace_id, r.id)
      if (channel) await refreshMarketingState(channel)
    }
  }
}

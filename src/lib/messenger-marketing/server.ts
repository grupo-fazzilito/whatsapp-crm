import 'server-only'
import { after } from 'next/server'
import type { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/db/prisma'
import { tenantDb } from '@/lib/db/tenant'
import { decrypt, encrypt } from '@/lib/whatsapp/encryption'
import { findChannelByExternalId, loadChannel } from '@/lib/channels/store'
import type { LoadedChannel } from '@/lib/channels/types'
import { getMetaConfig } from '@/lib/platform/meta'
import { createCampaign, listTokens, MarketingGraphError, sendCard, sendOptinRequest, type MetaToken } from './graph'
import { MIN_GAP_MS, normalizeMessengerSettings, type MessengerCard, type MessengerMarketingSettings, type OptinEvent } from './model'

// Marketing messages on Messenger: connection (page + ad account), the
// subscribers (opt-in in the chat, from the inbox, or imported from Meta)
// and Messenger broadcasts (a card to every subscriber, paid by the
// business through its ad account).

// ------------------------------------------------------------------
// Settings + connection
// ------------------------------------------------------------------
async function wsBasics(workspaceId: string) {
  return prisma.workspaces.findUnique({ where: { id: workspaceId }, select: { id: true, name: true, locale: true, timezone: true, settings: true } })
}

export async function messengerSettings(workspaceId: string): Promise<MessengerMarketingSettings> {
  const ws = await wsBasics(workspaceId)
  return normalizeMessengerSettings((ws?.settings as Record<string, unknown> | null)?.messenger_marketing, ws?.locale ?? 'es')
}

export async function saveMessengerSettings(workspaceId: string, raw: unknown): Promise<MessengerMarketingSettings> {
  const ws = await wsBasics(workspaceId)
  const next = normalizeMessengerSettings(raw, ws?.locale ?? 'es')
  const settings = { ...((ws?.settings ?? {}) as Record<string, unknown>), messenger_marketing: next }
  await prisma.workspaces.update({ where: { id: workspaceId }, data: { settings: settings as unknown as Prisma.InputJsonValue } })
  return next
}

export interface MessengerStatus {
  /** The platform's Meta app has the Messenger marketing configuration. */
  available: boolean
  connection: { page_id: string; page_name: string | null; ad_account_id: string; ad_account_name: string | null; currency: string | null; status: string; last_error: string | null } | null
  /** Messenger pages connected in Canales. */
  pages: { channel_id: string; page_id: string; name: string }[]
  subscribers: { subscribed: number; invited: number; stopped: number; ready: number }
  settings: MessengerMarketingSettings
}

export async function messengerStatus(workspaceId: string): Promise<MessengerStatus> {
  const db = tenantDb(workspaceId)
  const cfg = await getMetaConfig()
  const [conn, channels, settings, counts, ready] = await Promise.all([
    db.messenger_marketing.findFirst({ where: { workspace_id: workspaceId } }),
    db.channels.findMany({ where: { type: 'messenger', status: 'connected' }, select: { id: true, external_id: true, name: true } }),
    messengerSettings(workspaceId),
    db.messenger_subscribers.groupBy({ by: ['status'], _count: { _all: true } }),
    db.messenger_subscribers.count({ where: readyWhere() }),
  ])
  const n = (s: string) => counts.find((c) => c.status === s)?._count._all ?? 0
  const page = conn ? channels.find((c) => c.id === conn.channel_id) : null
  return {
    available: !!cfg.appId && !!cfg.appSecret && !!cfg.marketingConfigId,
    connection: conn
      ? {
          page_id: conn.page_id,
          page_name: page?.name ?? null,
          ad_account_id: conn.ad_account_id,
          ad_account_name: conn.ad_account_name,
          currency: conn.ad_account_currency,
          status: conn.status,
          last_error: conn.last_error,
        }
      : null,
    pages: channels.map((c) => ({ channel_id: c.id, page_id: c.external_id, name: c.name })),
    subscribers: { subscribed: n('subscribed'), invited: n('invited'), stopped: n('stopped'), ready },
    settings,
  }
}

export async function saveConnection(
  workspaceId: string,
  userId: string,
  c: { channelId: string; pageId: string; adAccount: { id: string; name: string; currency: string | null }; token: string },
): Promise<void> {
  const data = {
    channel_id: c.channelId,
    page_id: c.pageId,
    ad_account_id: c.adAccount.id,
    ad_account_name: c.adAccount.name,
    ad_account_currency: c.adAccount.currency,
    access_token: encrypt(c.token),
    status: 'active',
    last_error: null,
    connected_by: userId,
    updated_at: new Date(),
  }
  await prisma.messenger_marketing.upsert({ where: { workspace_id: workspaceId }, create: { workspace_id: workspaceId, ...data }, update: data })
}

export async function disconnectMarketing(workspaceId: string): Promise<void> {
  await tenantDb(workspaceId).messenger_marketing.deleteMany({})
}

async function connectionOf(workspaceId: string) {
  const conn = await tenantDb(workspaceId).messenger_marketing.findFirst({ where: { workspace_id: workspaceId } })
  if (!conn) return null
  try {
    return { ...conn, token: decrypt(conn.access_token) }
  } catch {
    return null
  }
}

// ------------------------------------------------------------------
// Subscribers
// ------------------------------------------------------------------
const readyWhere = (now = new Date()): Prisma.messenger_subscribersWhereInput => ({
  status: 'subscribed',
  token: { not: null },
  OR: [{ token_expires_at: null }, { token_expires_at: { gt: now } }],
})

async function contactFor(workspaceId: string, psid: string): Promise<string | null> {
  const id = await tenantDb(workspaceId).contact_identities.findFirst({ where: { channel_type: 'messenger', external_id: psid }, select: { contact_id: true } })
  return id?.contact_id ?? null
}

export type InviteResult = { ok: true } | { ok: false; error: 'not_connected' | 'already_subscribed' | 'failed'; message?: string }

/** Sends the opt-in request to one Messenger customer. */
export async function inviteSubscriber(channel: LoadedChannel, psid: string, source: 'chat' | 'inbox'): Promise<InviteResult> {
  const ws = channel.workspace_id
  const db = tenantDb(ws)
  if (!(await connectionOf(ws))) return { ok: false, error: 'not_connected' }
  const existing = await db.messenger_subscribers.findFirst({ where: { channel_id: channel.id, psid }, select: { id: true, status: true } })
  if (existing?.status === 'subscribed') return { ok: false, error: 'already_subscribed' }
  const basics = await wsBasics(ws)
  const settings = normalizeMessengerSettings((basics?.settings as Record<string, unknown> | null)?.messenger_marketing, basics?.locale ?? 'es')
  const token = channel.secrets.access_token
  if (!token) return { ok: false, error: 'not_connected' }
  try {
    await sendOptinRequest({ id: channel.external_id, token }, psid, {
      title: settings.invite_title,
      imageUrl: settings.invite_image_url,
      timezone: basics?.timezone || 'UTC',
      payload: `whasalia:${ws}`,
    })
  } catch (err) {
    return { ok: false, error: 'failed', message: err instanceof Error ? err.message : String(err) }
  }
  const now = new Date()
  const contactId = await contactFor(ws, psid)
  if (existing) await db.messenger_subscribers.updateMany({ where: { id: existing.id }, data: { status: 'invited', invited_at: now, updated_at: now, ...(contactId ? { contact_id: contactId } : {}) } })
  else await db.messenger_subscribers.create({ data: { workspace_id: ws, channel_id: channel.id, psid, contact_id: contactId, status: 'invited', source, invited_at: now } })
  return { ok: true }
}

/** First message of a Messenger customer: the opt-in request, once, when the business turned it on. Never throws. */
export async function maybeAutoInvite(channel: LoadedChannel, psids: string[]): Promise<void> {
  if (channel.type !== 'messenger' || !psids.length) return
  try {
    const settings = await messengerSettings(channel.workspace_id)
    if (!settings.auto_invite) return
    const db = tenantDb(channel.workspace_id)
    for (const psid of [...new Set(psids)]) {
      if (await db.messenger_subscribers.findFirst({ where: { channel_id: channel.id, psid }, select: { id: true } })) continue
      const r = await inviteSubscriber(channel, psid, 'chat')
      if (!r.ok && r.error === 'not_connected') return
      if (!r.ok) console.warn('[messenger-marketing] auto invite failed:', r.message ?? r.error)
    }
  } catch (err) {
    console.error('[messenger-marketing] auto invite failed:', err instanceof Error ? err.message : err)
  }
}

/** messaging_optins webhook: the customer accepted (or turned off) the offers. */
export async function applyOptins(events: OptinEvent[]): Promise<void> {
  for (const ev of events) {
    const channel = await findChannelByExternalId('messenger', ev.pageId)
    if (!channel) continue
    const ws = channel.workspace_id
    const db = tenantDb(ws)
    const now = new Date()
    const contactId = await contactFor(ws, ev.psid)
    const data =
      ev.status === 'stopped'
        ? { status: 'stopped', updated_at: now }
        : {
            status: 'subscribed',
            ...(ev.token ? { token: ev.token } : {}),
            token_expires_at: ev.expiresAt,
            subscribed_at: now,
            updated_at: now,
          }
    const existing = await db.messenger_subscribers.findFirst({ where: { channel_id: channel.id, psid: ev.psid }, select: { id: true } })
    if (existing) await db.messenger_subscribers.updateMany({ where: { id: existing.id }, data: { ...data, ...(contactId ? { contact_id: contactId } : {}) } })
    else await db.messenger_subscribers.create({ data: { workspace_id: ws, channel_id: channel.id, psid: ev.psid, contact_id: contactId, source: 'chat', ...data } })
  }
}

const expiry = (t: MetaToken) => (typeof t.token_expiry_timestamp === 'number' ? new Date(t.token_expiry_timestamp * (t.token_expiry_timestamp < 1e12 ? 1000 : 1)) : null)

/** Brings the subscribers Meta already has (Click-to-Messenger ads, audiences, earlier opt-ins). */
export async function importSubscribers(workspaceId: string): Promise<{ imported: number; updated: number }> {
  const conn = await connectionOf(workspaceId)
  if (!conn) throw new MarketingGraphError('not_connected')
  const channel = await loadChannel(workspaceId, conn.channel_id)
  const pageToken = channel?.secrets.access_token
  if (!channel || !pageToken) throw new MarketingGraphError('not_connected')
  const tokens = await listTokens({ id: channel.external_id, token: pageToken })
  const db = tenantDb(workspaceId)
  const out = { imported: 0, updated: 0 }
  const now = new Date()
  for (const t of tokens) {
    const stopped = t.user_token_status === 'STOPPED' || t.user_token_status === 'STOP_NOTIFICATIONS'
    const psid = t.recipient_id
    const existing = await db.messenger_subscribers.findFirst({
      where: { channel_id: channel.id, OR: [{ token: t.notification_messages_token }, ...(psid ? [{ psid }] : [])] },
      select: { id: true },
    })
    const data = { token: t.notification_messages_token, token_expires_at: expiry(t), status: stopped ? 'stopped' : 'subscribed', updated_at: now }
    if (existing) {
      await db.messenger_subscribers.updateMany({ where: { id: existing.id }, data })
      out.updated++
    } else {
      // Tokens from a Custom Audience upload come without the person's PSID.
      await db.messenger_subscribers.create({
        data: { workspace_id: workspaceId, channel_id: channel.id, psid: psid ?? `token:${t.notification_messages_token}`, contact_id: psid ? await contactFor(workspaceId, psid) : null, source: 'import', subscribed_at: now, ...data },
      })
      out.imported++
    }
  }
  return out
}

export async function subscriberStateFor(workspaceId: string, conversationId: string): Promise<{ messenger: boolean; status: string | null; connected: boolean }> {
  const db = tenantDb(workspaceId)
  const conv = await db.conversations.findFirst({ where: { id: conversationId }, select: { channel_id: true, contact_id: true, channels: { select: { type: true } } } })
  if (!conv || conv.channels?.type !== 'messenger' || !conv.channel_id) return { messenger: false, status: null, connected: false }
  const ident = await db.contact_identities.findFirst({ where: { contact_id: conv.contact_id, channel_type: 'messenger' }, select: { external_id: true } })
  const sub = ident ? await db.messenger_subscribers.findFirst({ where: { channel_id: conv.channel_id, psid: ident.external_id }, select: { status: true } }) : null
  return { messenger: true, status: sub?.status ?? null, connected: !!(await connectionOf(workspaceId)) }
}

export async function inviteFromConversation(workspaceId: string, conversationId: string): Promise<InviteResult> {
  const db = tenantDb(workspaceId)
  const conv = await db.conversations.findFirst({ where: { id: conversationId }, select: { channel_id: true, contact_id: true } })
  const channel = conv?.channel_id ? await loadChannel(workspaceId, conv.channel_id) : null
  if (!conv || !channel || channel.type !== 'messenger') return { ok: false, error: 'failed', message: 'not_messenger' }
  const ident = await db.contact_identities.findFirst({ where: { contact_id: conv.contact_id, channel_type: 'messenger' }, select: { external_id: true } })
  if (!ident) return { ok: false, error: 'failed', message: 'no_psid' }
  return inviteSubscriber(channel, ident.external_id, 'inbox')
}

// ------------------------------------------------------------------
// Broadcasts
// ------------------------------------------------------------------
export interface MessengerAudience {
  tagIds: string[]
}

async function audienceRows(workspaceId: string, channelId: string, a: MessengerAudience) {
  const db = tenantDb(workspaceId)
  const now = new Date()
  let contactIds: string[] | null = null
  if (a.tagIds.length) {
    contactIds = [...new Set((await db.contact_tags.findMany({ where: { tag_id: { in: a.tagIds } }, select: { contact_id: true } })).map((r) => r.contact_id))]
  }
  const rows = await db.messenger_subscribers.findMany({
    where: { channel_id: channelId, ...readyWhere(now), ...(contactIds ? { contact_id: { in: contactIds } } : {}) },
    select: { id: true, contact_id: true, last_sent_at: true },
    take: 50_000,
  })
  const cutoff = now.getTime() - MIN_GAP_MS
  const ready = rows.filter((r) => !r.last_sent_at || new Date(r.last_sent_at).getTime() < cutoff)
  return { ready, tooSoon: rows.length - ready.length }
}

export async function audienceCount(workspaceId: string, a: MessengerAudience): Promise<{ ready: number; too_soon: number }> {
  const conn = await connectionOf(workspaceId)
  if (!conn) return { ready: 0, too_soon: 0 }
  const r = await audienceRows(workspaceId, conn.channel_id, a)
  return { ready: r.ready.length, too_soon: r.tooSoon }
}

export type CreateResult = { ok: true; id: string; recipients: number } | { ok: false; error: 'not_connected' | 'empty' }

export async function createMessengerBroadcast(
  workspaceId: string,
  userId: string,
  input: { name: string; card: MessengerCard; audience: MessengerAudience; budget: number | null; scheduledAt: Date | null },
): Promise<CreateResult> {
  const conn = await connectionOf(workspaceId)
  if (!conn) return { ok: false, error: 'not_connected' }
  const { ready } = await audienceRows(workspaceId, conn.channel_id, input.audience)
  if (!ready.length) return { ok: false, error: 'empty' }
  const db = tenantDb(workspaceId)
  const scheduled = input.scheduledAt && input.scheduledAt.getTime() > Date.now() + 60_000 ? input.scheduledAt : null
  const b = await db.broadcasts.create({
    data: {
      workspace_id: workspaceId,
      user_id: userId,
      name: input.name,
      kind: 'messenger_card',
      template_name: 'messenger_card',
      template_language: '',
      message: input.card as unknown as Prisma.InputJsonValue,
      audience_filter: { channel: 'messenger', tagIds: input.audience.tagIds } as Prisma.InputJsonValue,
      budget: input.budget,
      channel_id: conn.channel_id,
      scheduled_at: scheduled ?? new Date(),
      status: 'scheduled',
      total_recipients: ready.length,
    },
    select: { id: true },
  })
  for (let i = 0; i < ready.length; i += 1000) {
    await db.broadcast_recipients.createMany({
      data: ready.slice(i, i + 1000).map((r) => ({ workspace_id: workspaceId, broadcast_id: b.id, contact_id: r.contact_id, subscriber_id: r.id, status: 'pending' })),
    })
  }
  if (!scheduled) kickMessengerBroadcast(workspaceId, b.id)
  return { ok: true, id: b.id, recipients: ready.length }
}

const runningBroadcasts = new Set<string>()
const PER_RUN = 400

/** Sends the pending recipients of one Messenger broadcast (a slice per run). Never throws. */
export async function processMessengerBroadcast(workspaceId: string, id: string): Promise<void> {
  if (runningBroadcasts.has(id)) return
  runningBroadcasts.add(id)
  try {
    await processOne(workspaceId, id)
  } catch (err) {
    console.error('[messenger-marketing] broadcast failed:', err instanceof Error ? err.message : err)
  } finally {
    runningBroadcasts.delete(id)
  }
}

async function processOne(workspaceId: string, id: string): Promise<void> {
  const db = tenantDb(workspaceId)
  const now = new Date()
  const claimed = await db.broadcasts.updateMany({
    where: { id, kind: 'messenger_card', OR: [{ status: 'scheduled', scheduled_at: { lte: now } }, { status: 'sending' }] },
    data: { status: 'sending', updated_at: now },
  })
  if (!claimed.count) return
  const b = await db.broadcasts.findFirst({ where: { id }, select: { name: true, message: true, meta_campaign_id: true, budget: true } })
  const conn = await connectionOf(workspaceId)
  const fail = async (message: string) => {
    await db.broadcast_recipients.updateMany({ where: { broadcast_id: id, status: 'pending' }, data: { status: 'failed', error_message: message } })
    await refreshCounts(workspaceId, id, 'failed')
  }
  if (!b || !conn) return fail('not_connected')
  const card = b.message as unknown as MessengerCard

  let campaignId = b.meta_campaign_id
  if (!campaignId) {
    try {
      const budget = b.budget == null ? null : Math.round(Number(b.budget) * 100)
      campaignId = await createCampaign(conn.token, conn.ad_account_id, { name: b.name, pageId: conn.page_id, lifetimeBudgetCents: budget })
      await db.broadcasts.updateMany({ where: { id }, data: { meta_campaign_id: campaignId } })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (err instanceof MarketingGraphError && err.auth) {
        await db.messenger_marketing.updateMany({ where: { workspace_id: workspaceId }, data: { status: 'error', last_error: msg, updated_at: new Date() } })
      }
      return fail(msg)
    }
  }

  const pending = await db.broadcast_recipients.findMany({
    where: { broadcast_id: id, status: 'pending' },
    select: { id: true, subscriber_id: true, messenger_subscribers: { select: { id: true, token: true, status: true, last_sent_at: true } } },
    take: PER_RUN,
  })
  const cutoff = Date.now() - MIN_GAP_MS
  for (let i = 0; i < pending.length; i += 5) {
    await Promise.all(
      pending.slice(i, i + 5).map(async (r) => {
        const s = r.messenger_subscribers
        const mark = (data: Prisma.broadcast_recipientsUncheckedUpdateManyInput) => db.broadcast_recipients.updateMany({ where: { id: r.id }, data })
        if (!s?.token || s.status !== 'subscribed') return mark({ status: 'failed', error_message: 'unsubscribed' })
        if (s.last_sent_at && new Date(s.last_sent_at).getTime() > cutoff) return mark({ status: 'failed', error_message: 'too_soon' })
        try {
          const tracking = await sendCard(conn.token, conn.ad_account_id, campaignId!, s.token, card)
          await db.messenger_subscribers.updateMany({ where: { id: s.id }, data: { last_sent_at: new Date() } })
          return mark({ status: 'sent', sent_at: new Date(), tracking_id: tracking })
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          // The person turned offers off or the token is no longer valid.
          if (/RECIPIENT_UNAVAILABLE|not available|invalid.*token|expired/i.test(msg)) {
            await db.messenger_subscribers.updateMany({ where: { id: s.id }, data: { status: 'stopped', updated_at: new Date() } })
          }
          return mark({ status: 'failed', error_message: msg.slice(0, 300) })
        }
      }),
    )
  }
  const left = await db.broadcast_recipients.count({ where: { broadcast_id: id, status: 'pending' } })
  await refreshCounts(workspaceId, id, left ? 'sending' : null)
}

async function refreshCounts(workspaceId: string, id: string, status: 'sending' | 'failed' | null) {
  const db = tenantDb(workspaceId)
  const groups = await db.broadcast_recipients.groupBy({ by: ['status'], where: { broadcast_id: id }, _count: { _all: true } })
  const n = (s: string) => groups.find((g) => g.status === s)?._count._all ?? 0
  const sent = n('sent') + n('delivered') + n('read') + n('replied')
  const failed = n('failed')
  await db.broadcasts.updateMany({
    where: { id },
    data: { sent_count: sent, failed_count: failed, status: status ?? (sent ? 'sent' : 'failed'), updated_at: new Date() },
  })
}

export function kickMessengerBroadcast(workspaceId: string, id: string): void {
  try {
    after(() => processMessengerBroadcast(workspaceId, id))
  } catch {
    void processMessengerBroadcast(workspaceId, id)
  }
}

/** Cron: scheduled Messenger broadcasts that are due, and those still sending. */
export async function runMessengerBroadcasts(): Promise<{ broadcasts: number }> {
  const due = await prisma.broadcasts
    .findMany({
      where: { kind: 'messenger_card', OR: [{ status: 'scheduled', scheduled_at: { lte: new Date() } }, { status: 'sending' }] },
      select: { id: true, workspace_id: true },
      take: 20,
    })
    .catch(() => [])
  for (const b of due) await processMessengerBroadcast(b.workspace_id, b.id)
  return { broadcasts: due.length }
}

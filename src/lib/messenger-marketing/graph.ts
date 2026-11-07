import 'server-only'
import { getMetaConfig } from '@/lib/platform/meta'
import { cardAttachment, type MessengerCard } from './model'

// Meta calls for marketing messages on Messenger (platform messaging app).
//   opt-in request   POST /{page}/messages  template_type=notification_messages (page token)
//   subscribers      GET  /{page}/notification_message_tokens (page token)
//   campaign         POST /act_{ad_account}/message_campaign (business system user token)
//   send             POST /act_{ad_account}/messages { message_id, messenger_delivery_data.subscription_token, message }

export class MarketingGraphError extends Error {
  constructor(
    message: string,
    readonly code: number | null = null,
    readonly subcode: number | null = null,
  ) {
    super(message)
  }
  get auth() {
    return this.code === 190 || this.code === 10 || (this.code !== null && this.code >= 200 && this.code < 300)
  }
}

async function graph<T>(path: string, token: string, init: { method?: 'GET' | 'POST' | 'DELETE'; body?: unknown; query?: Record<string, string> } = {}): Promise<T> {
  const { graphBase } = await getMetaConfig()
  const qs = init.query ? `?${new URLSearchParams(init.query)}` : ''
  const res = await fetch(`${graphBase}${path}${qs}`, {
    method: init.method ?? 'GET',
    cache: 'no-store',
    headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(30_000),
  })
  const data = (await res.json().catch(() => ({}))) as T & { error?: { message?: string; error_user_msg?: string; code?: number; error_subcode?: number } }
  if (!res.ok || data.error) {
    const e = data.error
    throw new MarketingGraphError((e?.error_user_msg || e?.message || `Meta API error ${res.status}`).slice(0, 300), e?.code ?? null, e?.error_subcode ?? null)
  }
  return data
}

/** "¿Quieres recibir ofertas?" request in the chat (the customer accepts with one tap). */
export async function sendOptinRequest(page: { id: string; token: string }, psid: string, opts: { title: string; imageUrl: string | null; timezone: string; payload: string }) {
  return graph<{ message_id?: string }>(`/${encodeURIComponent(page.id)}/messages`, page.token, {
    method: 'POST',
    body: {
      recipient: { id: psid },
      page: page.id,
      message: {
        attachment: {
          type: 'template',
          payload: {
            template_type: 'notification_messages',
            notification_messages_timezone: opts.timezone,
            title: opts.title,
            ...(opts.imageUrl ? { image_url: opts.imageUrl } : {}),
            payload: opts.payload,
          },
        },
      },
    },
  })
}

export interface MetaToken {
  notification_messages_token: string
  recipient_id?: string
  token_expiry_timestamp?: number
  user_token_status?: string
}

/** Every subscriber Meta has for the page (chat opt-ins, Click-to-Messenger ads, audiences). */
export async function listTokens(page: { id: string; token: string }, max = 10_000): Promise<MetaToken[]> {
  const out: MetaToken[] = []
  let after: string | undefined
  for (let i = 0; i < 50 && out.length < max; i++) {
    const r = await graph<{ data?: MetaToken[]; paging?: { cursors?: { after?: string }; next?: string } }>(`/${encodeURIComponent(page.id)}/notification_message_tokens`, page.token, {
      query: { limit: '1000', ...(after ? { after } : {}) },
    })
    out.push(...(r.data ?? []))
    after = r.paging?.next ? r.paging.cursors?.after : undefined
    if (!after) break
  }
  return out
}

export async function createCampaign(token: string, adAccountId: string, c: { name: string; pageId: string; lifetimeBudgetCents: number | null }): Promise<string> {
  const r = await graph<{ id?: string }>(`/act_${encodeURIComponent(adAccountId)}/message_campaign`, token, {
    method: 'POST',
    body: {
      name: c.name.slice(0, 200),
      page_id: c.pageId,
      ...(c.lifetimeBudgetCents ? { lifetime_budget: c.lifetimeBudgetCents } : {}),
      start_time: Math.floor(Date.now() / 1000),
      end_time: Math.floor(Date.now() / 1000) + 7 * 86_400,
    },
  })
  if (!r.id) throw new MarketingGraphError('campaign_not_created')
  return r.id
}

export async function sendCard(token: string, adAccountId: string, campaignId: string, subscriptionToken: string, card: MessengerCard): Promise<string | null> {
  const r = await graph<{ success?: boolean; marketing_message_tracking_id?: string }>(`/act_${encodeURIComponent(adAccountId)}/messages`, token, {
    method: 'POST',
    body: { message_id: campaignId, messenger_delivery_data: { subscription_token: subscriptionToken }, message: cardAttachment(card) },
  })
  return r.marketing_message_tracking_id ?? null
}

// ------------------------------------------------------------------
// Connection (Facebook Login for Business, system user token)
// ------------------------------------------------------------------
export interface AdAccount {
  id: string
  name: string
  currency: string | null
}

export interface MarketingAssets {
  token: string
  pages: { id: string; name: string }[]
  adAccounts: AdAccount[]
}

export async function assetsFromCode(code: string, redirectUri: string): Promise<MarketingAssets> {
  const cfg = await getMetaConfig()
  const res = await fetch(
    `${cfg.graphBase}/oauth/access_token?${new URLSearchParams({ client_id: cfg.appId!, client_secret: cfg.appSecret!, redirect_uri: redirectUri, code })}`,
    { cache: 'no-store', signal: AbortSignal.timeout(30_000) },
  )
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; error?: { message?: string; code?: number } }
  if (!res.ok || !data.access_token) throw new MarketingGraphError(data.error?.message ?? `Meta API error ${res.status}`, data.error?.code ?? null)
  const token = data.access_token
  const pages = await graph<{ data?: { id: string; name: string }[] }>('/me/accounts', token, { query: { fields: 'id,name', limit: '100' } })
  const ads = await graph<{ data?: { account_id?: string; id: string; name?: string; currency?: string }[] }>('/me/adaccounts', token, {
    query: { fields: 'account_id,name,currency', limit: '100' },
  })
  return {
    token,
    pages: pages.data ?? [],
    adAccounts: (ads.data ?? []).map((a) => ({ id: a.account_id ?? a.id.replace(/^act_/, ''), name: a.name ?? a.id, currency: a.currency ?? null })),
  }
}

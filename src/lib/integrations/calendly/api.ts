import 'server-only'
import { prisma } from '@/lib/db/prisma'
import { decrypt, encrypt } from '@/lib/whatsapp/encryption'
import { getCalendlyConfig } from './config'
import { calendlyEndpoints, calendlyRedirectUri } from './endpoints'
import type { AvailableTime, CalendlyInvitee, CalendlyScheduledEvent } from './model'

export class CalendlyApiError extends Error {
  constructor(message: string, readonly status: number, readonly body: unknown = null) {
    super(message)
    this.name = 'CalendlyApiError'
  }
  /** The account's plan doesn't allow this (booking by API, webhooks). */
  get planLimited(): boolean {
    return this.status === 403
  }
}

export interface TokenSet {
  access_token: string
  refresh_token: string
  expires_in: number
  owner?: string
  organization?: string
}

// ------------------------------------------------------------------ OAuth

export async function buildAuthUrl(state: string): Promise<string | null> {
  const cfg = await getCalendlyConfig()
  if (!cfg) return null
  const u = new URL(calendlyEndpoints().auth)
  u.searchParams.set('client_id', cfg.clientId)
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('redirect_uri', calendlyRedirectUri())
  u.searchParams.set('state', state)
  return u.toString()
}

async function tokenRequest(params: Record<string, string>): Promise<TokenSet> {
  const cfg = await getCalendlyConfig()
  if (!cfg) throw new CalendlyApiError('calendly_not_configured', 500)
  const res = await fetch(calendlyEndpoints().token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...params, client_id: cfg.clientId, client_secret: cfg.clientSecret }),
    signal: AbortSignal.timeout(15_000),
  })
  const body = (await res.json().catch(() => null)) as (TokenSet & { error?: string; error_description?: string }) | null
  if (!res.ok || !body?.access_token) throw new CalendlyApiError(body?.error_description || body?.error || `token ${res.status}`, res.status, body)
  return body
}

export function exchangeCode(code: string): Promise<TokenSet> {
  return tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: calendlyRedirectUri() })
}

export async function revokeToken(token: string): Promise<void> {
  const cfg = await getCalendlyConfig()
  if (!cfg) return
  await fetch(calendlyEndpoints().revoke, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, token }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => {})
}

export async function saveTokens(connectionId: string, t: TokenSet) {
  const data = {
    access_token: encrypt(t.access_token),
    refresh_token: encrypt(t.refresh_token),
    token_expires_at: new Date(Date.now() + (t.expires_in || 7200) * 1000),
    updated_at: new Date(),
  }
  await prisma.calendly_connection_secrets.upsert({ where: { connection_id: connectionId }, create: { connection_id: connectionId, ...data }, update: data })
}

/**
 * Valid access token of a connection, refreshing it when it expires within a
 * minute. Refresh tokens are single-use, so refreshes are serialized per
 * connection with an advisory lock and the new one is saved before use.
 */
export async function getAccessToken(connectionId: string, force = false): Promise<string> {
  const read = () => prisma.calendly_connection_secrets.findUnique({ where: { connection_id: connectionId } })
  const s = await read()
  if (!s) throw new CalendlyApiError('not_connected', 401)
  if (!force && new Date(s.token_expires_at).getTime() - Date.now() > 60_000) return decrypt(s.access_token)

  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('calendly-refresh'), hashtext(${connectionId}))`
      const fresh = await tx.calendly_connection_secrets.findUnique({ where: { connection_id: connectionId } })
      if (!fresh) throw new CalendlyApiError('not_connected', 401)
      // Another request refreshed while we waited.
      if (new Date(fresh.updated_at).getTime() > new Date(s.updated_at).getTime() && new Date(fresh.token_expires_at).getTime() - Date.now() > 60_000) return decrypt(fresh.access_token)
      let t: TokenSet
      try {
        t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: decrypt(fresh.refresh_token) })
      } catch (err) {
        if (err instanceof CalendlyApiError && (err.status === 400 || err.status === 401)) {
          await tx.calendly_connections.update({ where: { id: connectionId }, data: { status: 'revoked', last_error: err.message, updated_at: new Date() } })
        }
        throw err
      }
      const data = {
        access_token: encrypt(t.access_token),
        refresh_token: encrypt(t.refresh_token),
        token_expires_at: new Date(Date.now() + (t.expires_in || 7200) * 1000),
        updated_at: new Date(),
      }
      await tx.calendly_connection_secrets.update({ where: { connection_id: connectionId }, data })
      return t.access_token
    },
    { timeout: 20_000 },
  )
}

// -------------------------------------------------------------------- API

/** Calls the API as a connection (or with a raw token), retrying once on 401. */
export async function call<T>(auth: { connectionId: string } | { token: string }, path: string, init: { method?: string; body?: unknown; query?: Record<string, string | undefined> } = {}): Promise<T> {
  const url = new URL(path.startsWith('http') ? path : `${calendlyEndpoints().api}${path}`)
  for (const [k, v] of Object.entries(init.query ?? {})) if (v !== undefined) url.searchParams.set(k, v)
  // Calendly returns absolute URIs; keep calls on the configured host (mock in tests).
  const api = new URL(calendlyEndpoints().api)
  url.protocol = api.protocol
  url.host = api.host
  if (api.pathname !== '/' && !url.pathname.startsWith(api.pathname)) url.pathname = api.pathname.replace(/\/$/, '') + url.pathname

  const send = async (token: string) =>
    fetch(url, {
      method: init.method ?? 'GET',
      headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(15_000),
    })
  let res = await send('token' in auth ? auth.token : await getAccessToken(auth.connectionId))
  if (res.status === 401 && 'connectionId' in auth) res = await send(await getAccessToken(auth.connectionId, true))
  if (res.status === 204) return null as T
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    const msg = (body as { message?: string; title?: string } | null)?.message || (body as { title?: string } | null)?.title || `calendly ${res.status}`
    throw new CalendlyApiError(msg, res.status, body)
  }
  return body as T
}

type Auth = { connectionId: string } | { token: string }

export interface CalendlyUser {
  uri: string
  name: string
  email: string
  scheduling_url: string
  timezone: string
  current_organization: string
}

export async function getMe(auth: Auth): Promise<CalendlyUser> {
  return (await call<{ resource: CalendlyUser }>(auth, '/users/me')).resource
}

export interface CalendlyEventType {
  uri: string
  name: string
  active: boolean
  duration: number
  scheduling_url: string
  locations?: { kind: string }[] | null
  secret?: boolean
}

export async function listEventTypes(auth: Auth, userUri: string): Promise<CalendlyEventType[]> {
  const all: CalendlyEventType[] = []
  let page: string | undefined
  for (let i = 0; i < 10; i++) {
    const r = await call<{ collection: CalendlyEventType[]; pagination: { next_page_token?: string | null } }>(auth, '/event_types', { query: { user: userUri, count: '100', page_token: page } })
    all.push(...r.collection)
    page = r.pagination?.next_page_token ?? undefined
    if (!page) break
  }
  return all
}

export async function availableTimes(auth: Auth, eventTypeUri: string, startIso: string, endIso: string): Promise<AvailableTime[]> {
  const r = await call<{ collection: AvailableTime[] }>(auth, '/event_type_available_times', { query: { event_type: eventTypeUri, start_time: startIso, end_time: endIso } })
  return r.collection ?? []
}

export interface CreatedInvitee {
  uri: string
  event: string
  cancel_url: string
  reschedule_url: string
}

export async function createInvitee(auth: Auth, body: Record<string, unknown>): Promise<CreatedInvitee> {
  return (await call<{ resource: CreatedInvitee }>(auth, '/invitees', { method: 'POST', body })).resource
}

export async function getScheduledEvent(auth: Auth, uri: string): Promise<CalendlyScheduledEvent> {
  return (await call<{ resource: CalendlyScheduledEvent }>(auth, uri)).resource
}

export async function listScheduledEvents(auth: Auth, userUri: string, q: { minStart: string; maxStart: string; status: 'active' | 'canceled' }): Promise<CalendlyScheduledEvent[]> {
  const all: CalendlyScheduledEvent[] = []
  let page: string | undefined
  for (let i = 0; i < 10; i++) {
    const r = await call<{ collection: CalendlyScheduledEvent[]; pagination: { next_page_token?: string | null } }>(auth, '/scheduled_events', {
      query: { user: userUri, min_start_time: q.minStart, max_start_time: q.maxStart, status: q.status, count: '100', sort: 'start_time:asc', page_token: page },
    })
    all.push(...r.collection)
    page = r.pagination?.next_page_token ?? undefined
    if (!page) break
  }
  return all
}

export async function listInvitees(auth: Auth, eventUri: string): Promise<CalendlyInvitee[]> {
  return (await call<{ collection: CalendlyInvitee[] }>(auth, `${eventUri}/invitees`, { query: { count: '100' } })).collection ?? []
}

export async function cancelScheduledEvent(auth: Auth, eventUri: string, reason: string): Promise<void> {
  await call(auth, `${eventUri}/cancellation`, { method: 'POST', body: { reason } })
}

export async function createWebhook(auth: Auth, input: { url: string; organization: string; user: string }): Promise<string> {
  const r = await call<{ resource: { uri: string } }>(auth, '/webhook_subscriptions', {
    method: 'POST',
    body: { url: input.url, events: ['invitee.created', 'invitee.canceled'], organization: input.organization, user: input.user, scope: 'user' },
  })
  return r.resource.uri
}

export async function deleteWebhook(auth: Auth, uri: string): Promise<void> {
  await call(auth, uri, { method: 'DELETE' }).catch(() => {})
}

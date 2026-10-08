import 'server-only'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { decrypt, encrypt } from '@/lib/whatsapp/encryption'
import { getGoogleConfig } from './config'
import { googleEndpoints } from './endpoints'
import { GoogleApiError, googleErrorFrom, refreshAccessToken } from './oauth'
import type { GoogleEvent } from './event'

// Calendar API v3 calls for one connection, with transparent access-token
// refresh. https://developers.google.com/workspace/calendar/api/v3/reference

export interface CalendarConnection {
  id: string
  workspace_id: string
  staff_id: string
  connected_by: string | null
  google_email: string | null
  calendar_id: string
  token_expires_at: string | null
  watch_channel_id: string | null
  watch_resource_id: string | null
  watch_expires_at: string | null
  status: 'active' | 'error' | 'revoked'
  last_error: string | null
  last_synced_at: string | null
}

export const CONNECTION_COLUMNS =
  'id, workspace_id, staff_id, connected_by, google_email, calendar_id, token_expires_at, watch_channel_id, watch_resource_id, watch_expires_at, status, last_error, last_synced_at'

interface Secrets {
  access_token: string
  refresh_token: string
  sync_token: string | null
  watch_token: string | null
}

export async function loadSecrets(conn: Pick<CalendarConnection, 'id' | 'workspace_id'>): Promise<Secrets | null> {
  const { data } = await supabaseAdmin()
    .from('calendar_connection_secrets')
    .select('access_token, refresh_token, sync_token, watch_token')
    .eq('connection_id', conn.id)
    .eq('workspace_id', conn.workspace_id)
    .maybeSingle()
  return (data as Secrets | null) ?? null
}

export async function markConnection(conn: Pick<CalendarConnection, 'id' | 'workspace_id'>, patch: Partial<CalendarConnection>) {
  await supabaseAdmin().from('calendar_connections').update(patch).eq('id', conn.id).eq('workspace_id', conn.workspace_id)
}

/** Valid access token; refreshes (and persists) when about to expire. */
export async function getAccessToken(conn: CalendarConnection, force = false): Promise<string> {
  const secrets = await loadSecrets(conn)
  if (!secrets) throw new GoogleApiError('connection has no tokens', 401, 'no_tokens')
  const expires = conn.token_expires_at ? new Date(conn.token_expires_at).getTime() : 0
  if (!force && expires - Date.now() > 60_000) return decrypt(secrets.access_token)

  const cfg = await getGoogleConfig()
  if (!cfg) throw new GoogleApiError('Google OAuth client is not configured', 503, 'not_configured')
  try {
    const tok = await refreshAccessToken(cfg, decrypt(secrets.refresh_token))
    const expiresAt = new Date(Date.now() + (tok.expires_in ?? 3600) * 1000).toISOString()
    const db = supabaseAdmin()
    await db
      .from('calendar_connection_secrets')
      .update({
        access_token: encrypt(tok.access_token),
        ...(tok.refresh_token ? { refresh_token: encrypt(tok.refresh_token) } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq('connection_id', conn.id)
    await markConnection(conn, { token_expires_at: expiresAt, ...(conn.status === 'error' ? { status: 'active', last_error: null } : {}) })
    conn.token_expires_at = expiresAt
    return tok.access_token
  } catch (err) {
    if (err instanceof GoogleApiError && err.reason === 'invalid_grant') {
      // The user revoked access, the token expired (7 days for apps in
      // "Testing") or the password changed: they must reconnect.
      await markConnection(conn, { status: 'revoked', last_error: err.message })
      conn.status = 'revoked'
    }
    throw err
  }
}

async function call<T>(conn: CalendarConnection, path: string, init: RequestInit & { query?: Record<string, string | undefined> } = {}): Promise<T | null> {
  const url = new URL(`${googleEndpoints().calendar}${path}`)
  for (const [k, v] of Object.entries(init.query ?? {})) if (v !== undefined) url.searchParams.set(k, v)
  let retried = false
  for (;;) {
    const token = await getAccessToken(conn, retried)
    const res = await fetch(url, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.headers ?? {}) },
      cache: 'no-store',
    })
    if (res.status === 401 && !retried) {
      retried = true
      continue
    }
    if (!res.ok) throw await googleErrorFrom(res, `${init.method ?? 'GET'} ${path}`)
    if (res.status === 204) return null
    const text = await res.text()
    return (text ? JSON.parse(text) : null) as T | null
  }
}

const cal = (conn: CalendarConnection) => `/calendars/${encodeURIComponent(conn.calendar_id || 'primary')}`

export async function freeBusy(conn: CalendarConnection, timeMin: string, timeMax: string): Promise<{ start: string; end: string }[]> {
  const id = conn.calendar_id || 'primary'
  const body = await call<{ calendars?: Record<string, { busy?: { start: string; end: string }[]; errors?: { reason: string }[] }> }>(
    conn,
    '/freeBusy',
    { method: 'POST', body: JSON.stringify({ timeMin, timeMax, items: [{ id }] }) },
  )
  const entry = body?.calendars?.[id] ?? Object.values(body?.calendars ?? {})[0]
  if (entry?.errors?.length) throw new GoogleApiError(`freeBusy: ${entry.errors[0].reason}`, 400, entry.errors[0].reason)
  return entry?.busy ?? []
}

export function insertEvent(conn: CalendarConnection, event: Record<string, unknown>, withMeet: boolean) {
  return call<GoogleEvent>(conn, `${cal(conn)}/events`, {
    method: 'POST',
    body: JSON.stringify(event),
    query: { sendUpdates: 'none', ...(withMeet ? { conferenceDataVersion: '1' } : {}) },
  })
}

export function patchEvent(conn: CalendarConnection, eventId: string, patch: Record<string, unknown>, withMeet: boolean) {
  return call<GoogleEvent>(conn, `${cal(conn)}/events/${encodeURIComponent(eventId)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
    query: { sendUpdates: 'none', ...(withMeet ? { conferenceDataVersion: '1' } : {}) },
  })
}

/** Deletes an event; already gone (404/410) counts as done. */
export async function deleteEvent(conn: CalendarConnection, eventId: string): Promise<void> {
  try {
    await call(conn, `${cal(conn)}/events/${encodeURIComponent(eventId)}`, { method: 'DELETE', query: { sendUpdates: 'none' } })
  } catch (err) {
    if (err instanceof GoogleApiError && (err.status === 404 || err.status === 410)) return
    throw err
  }
}

export interface EventsPage {
  items?: GoogleEvent[]
  nextPageToken?: string
  nextSyncToken?: string
}

/** events.list — incremental (syncToken) or full (timeMin) listing. */
export function listEvents(conn: CalendarConnection, opts: { syncToken?: string; timeMin?: string; pageToken?: string }) {
  return call<EventsPage>(conn, `${cal(conn)}/events`, {
    query: {
      maxResults: '250',
      showDeleted: 'true',
      ...(opts.syncToken ? { syncToken: opts.syncToken } : { timeMin: opts.timeMin }),
      pageToken: opts.pageToken,
    },
  })
}

export function watchEvents(conn: CalendarConnection, channel: { id: string; token: string; address: string; ttlSeconds?: number }) {
  return call<{ id: string; resourceId: string; expiration?: string }>(conn, `${cal(conn)}/events/watch`, {
    method: 'POST',
    body: JSON.stringify({
      id: channel.id,
      type: 'web_hook',
      address: channel.address,
      token: channel.token,
      params: { ttl: String(channel.ttlSeconds ?? 604800) },
    }),
  })
}

export async function stopChannel(conn: CalendarConnection, channelId: string, resourceId: string): Promise<void> {
  try {
    await call(conn, '/channels/stop', { method: 'POST', body: JSON.stringify({ id: channelId, resourceId }) })
  } catch (err) {
    if (err instanceof GoogleApiError && err.status === 404) return
    throw err
  }
}

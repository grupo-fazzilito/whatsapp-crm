import 'server-only'
import type { MlConfig } from './config'
import type { MlItem } from './mapping'

// Thin Mercado Libre REST client (official API only). Every call sends
// the token as an Authorization header, never in the query string.

export class MlApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message)
  }
}

export interface MlTokenResponse {
  access_token: string
  token_type?: string
  expires_in: number
  scope?: string
  user_id: number | string
  refresh_token?: string
}

const TIMEOUT_MS = 20_000

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal, headers: { accept: 'application/json', ...(init.headers ?? {}) } })
    const text = await res.text()
    let body: unknown = null
    try {
      body = text ? JSON.parse(text) : null
    } catch {
      body = null
    }
    if (!res.ok) {
      const b = (body ?? {}) as { error?: string; message?: string }
      throw new MlApiError(res.status, b.error || `http_${res.status}`, b.message || b.error || `HTTP ${res.status}`)
    }
    return body as T
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') throw new MlApiError(504, 'timeout', 'Mercado Libre did not answer in time')
    throw e
  } finally {
    clearTimeout(timer)
  }
}

function tokenRequest(cfg: MlConfig, params: Record<string, string>): Promise<MlTokenResponse> {
  if (!cfg.clientId || !cfg.clientSecret) throw new MlApiError(503, 'not_configured', 'Mercado Libre app is not configured')
  return request<MlTokenResponse>(cfg.endpoints.token, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, ...params }).toString(),
  })
}

export function exchangeCode(cfg: MlConfig, code: string, codeVerifier?: string | null) {
  return tokenRequest(cfg, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: cfg.redirectUri,
    ...(codeVerifier ? { code_verifier: codeVerifier } : {}),
  })
}

/** Refresh tokens are single-use: always store the new one returned. */
export function refreshTokens(cfg: MlConfig, refreshToken: string) {
  return tokenRequest(cfg, { grant_type: 'refresh_token', refresh_token: refreshToken })
}

export function authorizeUrl(cfg: MlConfig, state: string, codeChallenge?: string | null): string {
  const u = new URL(cfg.endpoints.authorize)
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('client_id', cfg.clientId ?? '')
  u.searchParams.set('redirect_uri', cfg.redirectUri)
  u.searchParams.set('state', state)
  if (codeChallenge) {
    u.searchParams.set('code_challenge', codeChallenge)
    u.searchParams.set('code_challenge_method', 'S256')
  }
  return u.toString()
}

export function mlGet<T>(cfg: MlConfig, token: string | null, path: string): Promise<T> {
  return request<T>(`${cfg.endpoints.api}${path}`, token ? { headers: { authorization: `Bearer ${token}` } } : {})
}

export interface MlMe {
  id: number | string
  nickname?: string
  site_id?: string
}

export const getMe = (cfg: MlConfig, token: string) => mlGet<MlMe>(cfg, token, '/users/me')

interface SearchResponse {
  results?: string[]
  paging?: { total?: number; offset?: number; limit?: number }
  scroll_id?: string | null
}

const PAGE = 50

/**
 * Ids of the seller's active items. Offset paging covers up to 1,000
 * items; beyond that the documented `search_type=scan` + scroll_id mode.
 */
export async function listActiveItemIds(cfg: MlConfig, token: string, userId: string, max: number): Promise<string[]> {
  const base = `/users/${encodeURIComponent(userId)}/items/search?status=active`
  const firstPage = await mlGet<SearchResponse>(cfg, token, `${base}&offset=0&limit=${PAGE}`)
  const total = firstPage.paging?.total ?? firstPage.results?.length ?? 0
  const ids = new Set(firstPage.results ?? [])
  if (total <= 1000) {
    for (let offset = PAGE; offset < Math.min(total, max); offset += PAGE) {
      const page = await mlGet<SearchResponse>(cfg, token, `${base}&offset=${offset}&limit=${PAGE}`)
      for (const id of page.results ?? []) ids.add(id)
      if (!page.results?.length) break
    }
  } else {
    ids.clear()
    let scroll: string | null | undefined = null
    for (let guard = 0; guard < 200 && ids.size < max; guard++) {
      const page: SearchResponse = await mlGet<SearchResponse>(
        cfg,
        token,
        `${base}&search_type=scan&limit=100${scroll ? `&scroll_id=${encodeURIComponent(scroll)}` : ''}`,
      )
      if (!page.results?.length) break
      for (const id of page.results) ids.add(id)
      scroll = page.scroll_id
      if (!scroll) break
    }
  }
  return [...ids].slice(0, max)
}

interface BulkEntry {
  id?: string
  status_code?: number
  code?: number
  body?: MlItem & { error?: string }
}

/** Items by id via /items/bulk (max 20 per call, replaces the deprecated /items?ids=). */
export async function getItems(cfg: MlConfig, token: string, ids: string[]): Promise<MlItem[]> {
  const out: MlItem[] = []
  for (let i = 0; i < ids.length; i += 20) {
    const chunk = ids.slice(i, i + 20)
    const res = await mlGet<BulkEntry[]>(cfg, token, `/items/bulk?ids=${chunk.map(encodeURIComponent).join(',')}`)
    for (const e of Array.isArray(res) ? res : []) {
      const status = e.status_code ?? e.code ?? 200
      if (status === 200 && e.body?.id) out.push(e.body)
    }
  }
  return out
}

export async function getDescription(cfg: MlConfig, token: string, itemId: string): Promise<string | null> {
  try {
    const d = await mlGet<{ plain_text?: string; text?: string }>(cfg, token, `/items/${encodeURIComponent(itemId)}/description`)
    return d?.plain_text || d?.text || null
  } catch (e) {
    if (e instanceof MlApiError && e.status === 404) return null
    throw e
  }
}

export interface MlCategory {
  id: string
  path_from_root?: { id: string; name?: string }[]
}

export function getCategory(cfg: MlConfig, id: string): Promise<MlCategory> {
  return mlGet<MlCategory>(cfg, null, `/categories/${encodeURIComponent(id)}`)
}

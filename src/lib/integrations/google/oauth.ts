// OAuth 2.0 for web server apps (plain fetch, no googleapis package).
// https://developers.google.com/identity/protocols/oauth2/web-server

import { GOOGLE_SCOPES, googleEndpoints, redirectUri } from './endpoints'
import type { GoogleOAuthConfig } from './config'

export class GoogleApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Google error code, e.g. invalid_grant, rateLimitExceeded. */
    readonly reason: string | null = null,
  ) {
    super(message)
    this.name = 'GoogleApiError'
  }
}

export interface TokenResponse {
  access_token: string
  expires_in: number
  refresh_token?: string
  scope?: string
  token_type?: string
  id_token?: string
}

export function buildAuthUrl(cfg: Pick<GoogleOAuthConfig, 'clientId'>, state: string, loginHint?: string | null): string {
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: GOOGLE_SCOPES.join(' '),
    // offline + consent: Google returns a refresh token every time.
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  })
  if (loginHint) params.set('login_hint', loginHint)
  return `${googleEndpoints().auth}?${params.toString()}`
}

async function errorFrom(res: Response, what: string): Promise<GoogleApiError> {
  const body = (await res.json().catch(() => null)) as
    | { error?: string | { message?: string; errors?: { reason?: string }[]; status?: string }; error_description?: string }
    | null
  if (body && typeof body.error === 'string') {
    return new GoogleApiError(`${what}: ${body.error}${body.error_description ? ` (${body.error_description})` : ''}`, res.status, body.error)
  }
  const err = body && typeof body.error === 'object' ? body.error : null
  const reason = err?.errors?.[0]?.reason ?? err?.status ?? null
  return new GoogleApiError(`${what}: ${err?.message ?? res.statusText ?? res.status}`, res.status, reason)
}

async function tokenRequest(form: Record<string, string>, what: string): Promise<TokenResponse> {
  const res = await fetch(googleEndpoints().token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
    cache: 'no-store',
  })
  if (!res.ok) throw await errorFrom(res, what)
  return (await res.json()) as TokenResponse
}

export function exchangeCode(cfg: GoogleOAuthConfig, code: string): Promise<TokenResponse> {
  return tokenRequest(
    {
      code,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: redirectUri(),
      grant_type: 'authorization_code',
    },
    'token exchange',
  )
}

export function refreshAccessToken(cfg: GoogleOAuthConfig, refreshToken: string): Promise<TokenResponse> {
  return tokenRequest(
    { client_id: cfg.clientId, client_secret: cfg.clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' },
    'token refresh',
  )
}

/** Revokes the grant (access or refresh token). Best effort. */
export async function revokeToken(token: string): Promise<boolean> {
  try {
    const res = await fetch(googleEndpoints().revoke, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }).toString(),
      cache: 'no-store',
    })
    return res.ok
  } catch {
    return false
  }
}

export async function fetchUserEmail(accessToken: string): Promise<string | null> {
  const res = await fetch(googleEndpoints().userinfo, { headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store' })
  if (!res.ok) throw await errorFrom(res, 'userinfo')
  const body = (await res.json()) as { email?: string }
  return body.email ?? null
}

export { errorFrom as googleErrorFrom }

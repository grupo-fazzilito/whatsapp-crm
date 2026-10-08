// Google endpoints (OAuth 2.0 for web server apps + Calendar API v3).
// GOOGLE_API_MOCK_URL points every endpoint at a local mock, and is
// ignored in production so a stray env var can never leak tokens.

export const GOOGLE_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.freebusy',
] as const

export interface GoogleEndpoints {
  auth: string
  token: string
  revoke: string
  userinfo: string
  calendar: string
}

const REAL: GoogleEndpoints = {
  auth: 'https://accounts.google.com/o/oauth2/v2/auth',
  token: 'https://oauth2.googleapis.com/token',
  revoke: 'https://oauth2.googleapis.com/revoke',
  userinfo: 'https://openidconnect.googleapis.com/v1/userinfo',
  calendar: 'https://www.googleapis.com/calendar/v3',
}

export function googleEndpoints(env: Record<string, string | undefined> = process.env): GoogleEndpoints {
  const mock = env.GOOGLE_API_MOCK_URL?.replace(/\/$/, '')
  if (!mock || env.NODE_ENV === 'production') return REAL
  return {
    auth: `${mock}/o/oauth2/v2/auth`,
    token: `${mock}/token`,
    revoke: `${mock}/revoke`,
    userinfo: `${mock}/v1/userinfo`,
    calendar: `${mock}/calendar/v3`,
  }
}

/** Public base URL of this app (no trailing slash). */
export function siteUrl(env: Record<string, string | undefined> = process.env): string {
  return (env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/$/, '')
}

export function redirectUri(env: Record<string, string | undefined> = process.env): string {
  return `${siteUrl(env)}/api/integrations/google/callback`
}

export function webhookUrl(env: Record<string, string | undefined> = process.env): string {
  return `${siteUrl(env)}/api/integrations/google/webhook`
}

/** Google only delivers push notifications to HTTPS addresses. */
export function pushSupported(env: Record<string, string | undefined> = process.env): boolean {
  return siteUrl(env).startsWith('https://')
}

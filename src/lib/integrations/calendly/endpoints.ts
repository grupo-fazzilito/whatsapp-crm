// Calendly endpoints (OAuth 2.0 + API v2). CALENDLY_API_MOCK_URL points
// every endpoint at a local mock and is ignored in production.
import { siteUrl } from '@/lib/integrations/google/endpoints'

export interface CalendlyEndpoints {
  auth: string
  token: string
  revoke: string
  api: string
}

const REAL: CalendlyEndpoints = {
  auth: 'https://auth.calendly.com/oauth/authorize',
  token: 'https://auth.calendly.com/oauth/token',
  revoke: 'https://auth.calendly.com/oauth/revoke',
  api: 'https://api.calendly.com',
}

export function calendlyEndpoints(env: Record<string, string | undefined> = process.env): CalendlyEndpoints {
  const mock = env.CALENDLY_API_MOCK_URL?.replace(/\/$/, '')
  if (!mock || env.NODE_ENV === 'production') return REAL
  return { auth: `${mock}/oauth/authorize`, token: `${mock}/oauth/token`, revoke: `${mock}/oauth/revoke`, api: mock }
}

export function calendlyRedirectUri(env: Record<string, string | undefined> = process.env): string {
  return `${siteUrl(env)}/api/integrations/calendly/callback`
}

export function calendlyWebhookUrl(env: Record<string, string | undefined> = process.env): string {
  return `${siteUrl(env)}/api/integrations/calendly/webhook`
}

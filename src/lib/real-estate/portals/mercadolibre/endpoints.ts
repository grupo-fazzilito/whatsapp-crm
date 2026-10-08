// Mercado Libre endpoints (developers.mercadolibre.com.pe):
//   authorization  https://auth.mercadolibre.com.pe/authorization (per site)
//   token          POST https://api.mercadolibre.com/oauth/token
//   API            https://api.mercadolibre.com
// A mock base URL (local E2E) replaces all of them and is ignored in
// production so a stray setting can never send tokens elsewhere.

export const ML_SITES = ['MPE', 'MLA', 'MLM', 'MCO', 'MLC', 'MLU'] as const
export type MlSite = (typeof ML_SITES)[number]

const AUTH_DOMAIN: Record<MlSite, string> = {
  MPE: 'https://auth.mercadolibre.com.pe',
  MLA: 'https://auth.mercadolibre.com.ar',
  MLM: 'https://auth.mercadolibre.com.mx',
  MCO: 'https://auth.mercadolibre.com.co',
  MLC: 'https://auth.mercadolibre.cl',
  MLU: 'https://auth.mercadolibre.com.uy',
}

export interface MlEndpoints {
  authorize: string
  token: string
  api: string
  mock: boolean
}

export function isMlSite(s: unknown): s is MlSite {
  return typeof s === 'string' && (ML_SITES as readonly string[]).includes(s)
}

export function mlEndpoints(site: MlSite, mockUrl: string | null | undefined, nodeEnv: string | undefined = process.env.NODE_ENV): MlEndpoints {
  const mock = mockUrl?.trim().replace(/\/$/, '')
  if (mock && nodeEnv !== 'production') {
    return { authorize: `${mock}/authorization`, token: `${mock}/oauth/token`, api: mock, mock: true }
  }
  return {
    authorize: `${AUTH_DOMAIN[site]}/authorization`,
    token: 'https://api.mercadolibre.com/oauth/token',
    api: 'https://api.mercadolibre.com',
    mock: false,
  }
}

/** Public base URL of this app (no trailing slash). */
export function appUrl(env: Record<string, string | undefined> = process.env): string {
  return (env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/$/, '')
}

/** Redirect URI to register in the Mercado Libre app (must be static). */
export function mlRedirectUri(env: Record<string, string | undefined> = process.env): string {
  return `${appUrl(env)}/api/real-estate/portals/mercadolibre/callback`
}

import 'server-only'
import { getPlatformSetting, setPlatformSetting } from '@/lib/platform/settings'
import { decrypt, encrypt } from '@/lib/whatsapp/encryption'
import { isMlSite, mlEndpoints, mlRedirectUri, type MlEndpoints, type MlSite } from './endpoints'

// Platform-level Mercado Libre app credentials (one app for the whole
// SaaS; each workspace authorizes it with OAuth). Stored encrypted in
// platform_settings['mercadolibre'], env vars as fallback:
//   MERCADOLIBRE_CLIENT_ID / MERCADOLIBRE_CLIENT_SECRET / MERCADOLIBRE_SITE_ID
// Non-production only: MERCADOLIBRE_API_MOCK_URL or `dev_mock_url`.

export interface StoredMlSettings {
  client_id?: string
  /** encrypted */
  client_secret?: string
  site_id?: MlSite
  /** The app has PKCE enabled in the ML developer panel. */
  pkce?: boolean
  dev_mock_url?: string
}

export interface MlConfig {
  clientId: string | null
  clientSecret: string | null
  site: MlSite
  pkce: boolean
  source: 'panel' | 'env' | null
  endpoints: MlEndpoints
  redirectUri: string
}

export function buildMlConfig(stored: StoredMlSettings | null, env: Record<string, string | undefined>): MlConfig {
  let secret: string | null = null
  if (stored?.client_secret) {
    try {
      secret = decrypt(stored.client_secret)
    } catch {
      console.warn('[mercadolibre] could not decrypt client secret (ENCRYPTION_KEY changed?)')
    }
  }
  const fromPanel = !!(stored?.client_id && secret)
  const clientId = fromPanel ? stored!.client_id! : env.MERCADOLIBRE_CLIENT_ID || null
  const clientSecret = fromPanel ? secret : env.MERCADOLIBRE_CLIENT_SECRET || null
  const site = isMlSite(stored?.site_id) ? stored!.site_id! : isMlSite(env.MERCADOLIBRE_SITE_ID) ? (env.MERCADOLIBRE_SITE_ID as MlSite) : 'MPE'
  return {
    clientId,
    clientSecret,
    site,
    pkce: !!stored?.pkce,
    source: fromPanel ? 'panel' : clientId && clientSecret ? 'env' : null,
    endpoints: mlEndpoints(site, env.MERCADOLIBRE_API_MOCK_URL || stored?.dev_mock_url, env.NODE_ENV),
    redirectUri: mlRedirectUri(env),
  }
}

export async function getMlConfig(): Promise<MlConfig> {
  return buildMlConfig(await getPlatformSetting<StoredMlSettings>('mercadolibre'), process.env)
}

export interface MlSettingsUpdate {
  client_id?: string | null
  /** string = replace, null = remove, undefined = keep */
  client_secret?: string | null
  site_id?: MlSite
  pkce?: boolean
}

export async function updateMlSettings(update: MlSettingsUpdate, userId: string | null): Promise<void> {
  const next: StoredMlSettings = { ...((await getPlatformSetting<StoredMlSettings>('mercadolibre')) ?? {}) }
  if (update.client_id !== undefined) {
    if (update.client_id) next.client_id = update.client_id.trim()
    else delete next.client_id
  }
  if (typeof update.client_secret === 'string' && update.client_secret.trim()) next.client_secret = encrypt(update.client_secret.trim())
  else if (update.client_secret === null) delete next.client_secret
  if (update.site_id) next.site_id = update.site_id
  if (update.pkce !== undefined) next.pkce = update.pkce
  await setPlatformSetting('mercadolibre', next, userId)
}

/** Admin view: never returns the secret. */
export function maskedMlSettings(cfg: MlConfig, stored: StoredMlSettings | null) {
  return {
    configured: !!(cfg.clientId && cfg.clientSecret),
    source: cfg.source,
    client_id: stored?.client_id ?? (cfg.source === 'env' ? cfg.clientId : '') ?? '',
    secret_hint: cfg.clientSecret ? `••••${cfg.clientSecret.slice(-4)}` : null,
    site_id: cfg.site,
    pkce: cfg.pkce,
    redirect_uri: cfg.redirectUri,
    mock: cfg.endpoints.mock,
  }
}

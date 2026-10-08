import 'server-only'
import { decrypt, encrypt } from '@/lib/whatsapp/encryption'
import { getPlatformSetting, setPlatformSetting } from '@/lib/platform/settings'
import { pushSupported, redirectUri, webhookUrl } from './endpoints'

// Google OAuth client of the platform (one per SaaS deployment), edited
// from the admin panel and stored in platform_settings['google'] with the
// secret encrypted. GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are the
// fallback when the panel has nothing.

export interface StoredGoogleSettings {
  client_id?: string
  /** encrypted */
  client_secret?: string
}

export interface GoogleOAuthConfig {
  clientId: string
  clientSecret: string
  source: 'panel' | 'env'
}

export function buildGoogleConfig(stored: StoredGoogleSettings | null, env: Record<string, string | undefined>): GoogleOAuthConfig | null {
  if (stored?.client_id && stored.client_secret) {
    try {
      return { clientId: stored.client_id, clientSecret: decrypt(stored.client_secret), source: 'panel' }
    } catch {
      console.warn('[google] could not decrypt the client secret (ENCRYPTION_KEY changed?)')
    }
  }
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    return { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, source: 'env' }
  }
  return null
}

export async function getGoogleConfig(): Promise<GoogleOAuthConfig | null> {
  return buildGoogleConfig(await getPlatformSetting<StoredGoogleSettings>('google'), process.env)
}

export async function updateGoogleSettings(
  update: { client_id?: string | null; client_secret?: string | null },
  userId: string | null,
): Promise<void> {
  const current = (await getPlatformSetting<StoredGoogleSettings>('google')) ?? {}
  const next: StoredGoogleSettings = { ...current }
  if (update.client_id === null) delete next.client_id
  else if (typeof update.client_id === 'string' && update.client_id.trim()) next.client_id = update.client_id.trim()
  if (update.client_secret === null) delete next.client_secret
  else if (typeof update.client_secret === 'string' && update.client_secret.trim()) next.client_secret = encrypt(update.client_secret.trim())
  await setPlatformSetting('google', next, userId)
}

/** Admin view: never returns the secret. */
export async function maskedGoogleSettings() {
  const stored = await getPlatformSetting<StoredGoogleSettings>('google')
  const cfg = buildGoogleConfig(stored, process.env)
  return {
    configured: !!cfg,
    source: cfg?.source ?? null,
    client_id: cfg?.clientId ?? '',
    secret_hint: cfg ? `••••${cfg.clientSecret.slice(-4)}` : null,
    panel_client_id: stored?.client_id ?? '',
    redirect_uri: redirectUri(),
    webhook_url: webhookUrl(),
    push_supported: pushSupported(),
  }
}

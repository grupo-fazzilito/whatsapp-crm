import 'server-only'
import { decrypt, encrypt } from '@/lib/whatsapp/encryption'
import { getPlatformSetting, setPlatformSetting } from '@/lib/platform/settings'
import { calendlyRedirectUri, calendlyWebhookUrl } from './endpoints'

// Calendly OAuth app of the platform (developer.calendly.com), edited from
// the admin panel and stored in platform_settings['calendly'] with the
// secrets encrypted. CALENDLY_CLIENT_ID / CALENDLY_CLIENT_SECRET /
// CALENDLY_WEBHOOK_SIGNING_KEY are the fallback.

export interface StoredCalendlySettings {
  client_id?: string
  /** encrypted */
  client_secret?: string
  /** encrypted — given by Calendly when the OAuth app is created */
  webhook_signing_key?: string
}

export interface CalendlyConfig {
  clientId: string
  clientSecret: string
  webhookSigningKey: string | null
  source: 'panel' | 'env'
}

export function buildCalendlyConfig(stored: StoredCalendlySettings | null, env: Record<string, string | undefined>): CalendlyConfig | null {
  if (stored?.client_id && stored.client_secret) {
    try {
      return {
        clientId: stored.client_id,
        clientSecret: decrypt(stored.client_secret),
        webhookSigningKey: stored.webhook_signing_key ? decrypt(stored.webhook_signing_key) : null,
        source: 'panel',
      }
    } catch {
      console.warn('[calendly] could not decrypt the app secrets (ENCRYPTION_KEY changed?)')
    }
  }
  if (env.CALENDLY_CLIENT_ID && env.CALENDLY_CLIENT_SECRET) {
    return { clientId: env.CALENDLY_CLIENT_ID, clientSecret: env.CALENDLY_CLIENT_SECRET, webhookSigningKey: env.CALENDLY_WEBHOOK_SIGNING_KEY || null, source: 'env' }
  }
  return null
}

export async function getCalendlyConfig(): Promise<CalendlyConfig | null> {
  return buildCalendlyConfig(await getPlatformSetting<StoredCalendlySettings>('calendly'), process.env)
}

type SecretUpdate = string | null | undefined

export async function updateCalendlySettings(update: { client_id?: SecretUpdate; client_secret?: SecretUpdate; webhook_signing_key?: SecretUpdate }, userId: string | null) {
  const current = (await getPlatformSetting<StoredCalendlySettings>('calendly')) ?? {}
  const next: StoredCalendlySettings = { ...current }
  if (update.client_id === null) delete next.client_id
  else if (typeof update.client_id === 'string' && update.client_id.trim()) next.client_id = update.client_id.trim()
  for (const k of ['client_secret', 'webhook_signing_key'] as const) {
    const v = update[k]
    if (v === null) delete next[k]
    else if (typeof v === 'string' && v.trim()) next[k] = encrypt(v.trim())
  }
  await setPlatformSetting('calendly', next, userId)
}

/** Admin view: never returns the secrets. */
export async function maskedCalendlySettings() {
  const stored = await getPlatformSetting<StoredCalendlySettings>('calendly')
  const cfg = buildCalendlyConfig(stored, process.env)
  return {
    configured: !!cfg,
    source: cfg?.source ?? null,
    client_id: cfg?.clientId ?? '',
    secret_hint: cfg ? `••••${cfg.clientSecret.slice(-4)}` : null,
    signing_key_set: !!cfg?.webhookSigningKey,
    panel_client_id: stored?.client_id ?? '',
    redirect_uri: calendlyRedirectUri(),
    webhook_url: calendlyWebhookUrl(),
  }
}

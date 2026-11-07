import 'server-only'
import { decrypt, encrypt } from '@/lib/whatsapp/encryption'
import { getPlatformSetting, setPlatformSetting } from '@/lib/platform/settings'
import { getMetaConfig } from '@/lib/platform/meta'

// The second Meta app, only for Publicaciones (Facebook pages and Instagram
// accounts): its App Review (pages_manage_posts, instagram_content_publish…)
// is separate from messaging's. Edited in Superadmin → Settings → Meta and
// stored in platform_settings['meta_publishing'] (secret encrypted).
// Environment fallback: META_PUBLISH_APP_ID, META_PUBLISH_APP_SECRET, META_PUBLISH_CONFIG_ID.

interface StoredPublishing {
  app_id?: string
  /** encrypted */
  app_secret?: string
  /** Facebook Login for Business configuration (optional; without it the scopes below are asked). */
  config_id?: string
}

export interface PublishingConfig {
  appId: string | null
  appSecret: string | null
  configId: string | null
  graphVersion: string
  graphBase: string
  source: 'panel' | 'env' | null
}

/** What the business is asked when it connects (without a saved configuration). */
export const PUBLISH_SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
  'instagram_basic',
  'instagram_content_publish',
  'business_management',
]

function dec(v: string | undefined): string | null {
  if (!v) return null
  try {
    return decrypt(v)
  } catch {
    console.warn('[social] could not decrypt the publishing app secret (ENCRYPTION_KEY changed?)')
    return null
  }
}

export async function getPublishingConfig(): Promise<PublishingConfig> {
  const stored = await getPlatformSetting<StoredPublishing>('meta_publishing')
  const meta = await getMetaConfig()
  const panel = !!stored?.app_id
  const appId = stored?.app_id || process.env.META_PUBLISH_APP_ID || null
  const appSecret = (panel ? dec(stored?.app_secret) : null) || process.env.META_PUBLISH_APP_SECRET || null
  const configId = stored?.config_id || process.env.META_PUBLISH_CONFIG_ID || null
  return {
    appId,
    appSecret,
    configId,
    graphVersion: meta.graphVersion,
    graphBase: meta.graphBase,
    source: panel ? 'panel' : appId ? 'env' : null,
  }
}

export const publishingReady = (c: PublishingConfig) => !!c.appId && !!c.appSecret

export interface PublishingUpdate {
  /** string = set, null = remove, undefined = keep */
  app_id?: string | null
  app_secret?: string | null
  config_id?: string | null
}

export async function updatePublishingSettings(update: PublishingUpdate, userId: string | null): Promise<void> {
  const next: StoredPublishing = { ...((await getPlatformSetting<StoredPublishing>('meta_publishing')) ?? {}) }
  for (const k of ['app_id', 'config_id'] as const) {
    const v = update[k]
    if (v === null) delete next[k]
    else if (typeof v === 'string' && v.trim()) next[k] = v.trim()
  }
  if (update.app_secret === null) delete next.app_secret
  else if (typeof update.app_secret === 'string' && update.app_secret.trim()) next.app_secret = encrypt(update.app_secret.trim())
  await setPlatformSetting('meta_publishing', next, userId)
}

/** Admin view: never the secret. */
export async function maskedPublishingSettings(siteOrigin: string) {
  const stored = await getPlatformSetting<StoredPublishing>('meta_publishing')
  const cfg = await getPublishingConfig()
  return {
    configured: publishingReady(cfg),
    source: cfg.source,
    app_id: cfg.appId ?? '',
    panel_app_id: stored?.app_id ?? '',
    secret_hint: cfg.appSecret ? `••••${cfg.appSecret.slice(-4)}` : null,
    config_id: stored?.config_id ?? '',
    redirect_uri: `${siteOrigin.replace(/\/$/, '')}/api/social/oauth/callback`,
    scopes: PUBLISH_SCOPES,
  }
}

import 'server-only'
import crypto from 'node:crypto'
import { decrypt, encrypt } from '@/lib/whatsapp/encryption'
import { getPlatformSetting, setPlatformSetting } from './settings'

// The platform's Meta app (one per SaaS deployment): WhatsApp Embedded
// Signup, Messenger/Instagram login and the shared webhook. Edited from the
// admin panel and stored in platform_settings['meta'] (secrets encrypted).
// Environment variables remain the fallback for each field:
//   META_APP_ID, META_APP_SECRET, META_VERIFY_TOKEN,
//   META_ES_CONFIG_ID (falls back to META_LOGIN_CONFIG_ID), META_ES_COEX_CONFIG_ID,
//   META_LOGIN_CONFIG_ID (Messenger / Instagram login), META_GRAPH_VERSION.

export interface StoredMetaSettings {
  app_id?: string
  /** encrypted */
  app_secret?: string
  /** encrypted */
  verify_token?: string
  /** Facebook Login for Business configuration (Embedded Signup variation). */
  es_config_id?: string
  /** Optional separate configuration for WhatsApp Business app numbers (coexistence). */
  es_coex_config_id?: string
  /** Facebook Login for Business configuration for Messenger / Instagram pages. */
  login_config_id?: string
  graph_version?: string
  /**
   * Development only: base URL that replaces https://graph.facebook.com/<version>
   * (local mocks for E2E). Ignored when NODE_ENV is production.
   */
  dev_graph_base_url?: string
}

export type Source = 'panel' | 'env' | null

export interface MetaConfig {
  appId: string | null
  appSecret: string | null
  verifyToken: string | null
  esConfigId: string | null
  esCoexConfigId: string | null
  loginConfigId: string | null
  graphVersion: string
  /** Graph API base (version included), honouring the dev mock override. */
  graphBase: string
  sources: { appId: Source; appSecret: Source; verifyToken: Source; esConfigId: Source; loginConfigId: Source }
}

export const DEFAULT_GRAPH_VERSION = 'v25.0'
export const GRAPH_VERSION_RE = /^v\d{1,2}\.\d$/

function dec(value: string | undefined, label: string): string | null {
  if (!value) return null
  try {
    return decrypt(value)
  } catch {
    console.warn(`[meta-settings] could not decrypt ${label} (ENCRYPTION_KEY changed?)`)
    return null
  }
}

function pick(panel: string | null | undefined, env: string | undefined): [string | null, Source] {
  if (panel) return [panel, 'panel']
  if (env) return [env, 'env']
  return [null, null]
}

/** Pure merge of the stored settings and env (panel wins per field). */
export function buildMetaConfig(stored: StoredMetaSettings | null, env: Record<string, string | undefined>): MetaConfig {
  const [appId, appIdSrc] = pick(stored?.app_id, env.META_APP_ID)
  const [appSecret, secretSrc] = pick(dec(stored?.app_secret, 'app secret'), env.META_APP_SECRET)
  const [verifyToken, vtSrc] = pick(dec(stored?.verify_token, 'verify token'), env.META_VERIFY_TOKEN)
  const [esConfigId, esSrc] = pick(stored?.es_config_id, env.META_ES_CONFIG_ID || env.META_LOGIN_CONFIG_ID)
  const [esCoexConfigId] = pick(stored?.es_coex_config_id, env.META_ES_COEX_CONFIG_ID)
  const [loginConfigId, loginSrc] = pick(stored?.login_config_id, env.META_LOGIN_CONFIG_ID)
  const graphVersion =
    [stored?.graph_version, env.META_GRAPH_VERSION].find((v) => !!v && GRAPH_VERSION_RE.test(v)) ?? DEFAULT_GRAPH_VERSION
  const mock = env.NODE_ENV !== 'production' ? stored?.dev_graph_base_url || env.META_GRAPH_MOCK_URL : undefined
  return {
    appId,
    appSecret,
    verifyToken,
    esConfigId,
    esCoexConfigId,
    loginConfigId,
    graphVersion,
    graphBase: mock ? mock.replace(/\/$/, '') : `https://graph.facebook.com/${graphVersion}`,
    sources: { appId: appIdSrc, appSecret: secretSrc, verifyToken: vtSrc, esConfigId: esSrc, loginConfigId: loginSrc },
  }
}

export async function getMetaConfig(): Promise<MetaConfig> {
  return buildMetaConfig(await getPlatformSetting<StoredMetaSettings>('meta'), process.env)
}

/** App credentials needed for any server-side code exchange. */
export function metaAppReady(cfg: MetaConfig): boolean {
  return !!cfg.appId && !!cfg.appSecret
}

export interface MetaSettingsUpdate {
  /** string = set, null = remove (env fallback), undefined = keep */
  app_id?: string | null
  app_secret?: string | null
  verify_token?: string | null
  es_config_id?: string | null
  es_coex_config_id?: string | null
  login_config_id?: string | null
  graph_version?: string | null
}

export async function updateMetaSettings(update: MetaSettingsUpdate, userId: string | null): Promise<void> {
  const current = (await getPlatformSetting<StoredMetaSettings>('meta')) ?? {}
  const next: StoredMetaSettings = { ...current }
  const plain = ['app_id', 'es_config_id', 'es_coex_config_id', 'login_config_id', 'graph_version'] as const
  for (const k of plain) {
    const v = update[k]
    if (v === null) delete next[k]
    else if (typeof v === 'string' && v.trim()) next[k] = v.trim()
  }
  for (const k of ['app_secret', 'verify_token'] as const) {
    const v = update[k]
    if (v === null) delete next[k]
    else if (typeof v === 'string' && v.trim()) next[k] = encrypt(v.trim())
  }
  await setPlatformSetting('meta', next, userId)
}

export function generateVerifyToken(): string {
  return `vt_${crypto.randomBytes(24).toString('base64url')}`
}

const hint = (v: string | null) => (v ? `••••${v.slice(-4)}` : null)

/** Admin view: never returns the app secret (the verify token is shown, it must be pasted in Meta). */
export async function maskedMetaSettings(siteOrigin: string) {
  const stored = await getPlatformSetting<StoredMetaSettings>('meta')
  const cfg = buildMetaConfig(stored, process.env)
  return {
    configured: metaAppReady(cfg),
    app_id: cfg.appId ?? '',
    panel_app_id: stored?.app_id ?? '',
    secret_hint: hint(cfg.appSecret),
    verify_token: cfg.verifyToken ?? '',
    es_config_id: stored?.es_config_id ?? '',
    es_coex_config_id: stored?.es_coex_config_id ?? '',
    login_config_id: stored?.login_config_id ?? '',
    graph_version: stored?.graph_version ?? '',
    effective: {
      graph_version: cfg.graphVersion,
      es_config_id: cfg.esConfigId ?? '',
      login_config_id: cfg.loginConfigId ?? '',
    },
    sources: cfg.sources,
    webhook_url: `${siteOrigin.replace(/\/$/, '')}/api/webhooks/meta`,
    default_graph_version: DEFAULT_GRAPH_VERSION,
  }
}

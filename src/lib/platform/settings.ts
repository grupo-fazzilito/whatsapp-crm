import 'server-only'
import { prisma } from '@/lib/db/prisma'
import type { Prisma } from '@/generated/prisma/client'
import { decrypt, encrypt } from '@/lib/whatsapp/encryption'

// Platform-wide settings edited from the admin panel (platform_settings
// table, service role only). Values set here win over environment
// variables; env vars remain as a fallback so existing deployments keep
// working.

const TTL_MS = 30_000
const cache = new Map<string, { at: number; value: unknown }>()

export async function getPlatformSetting<T extends object>(key: string): Promise<T | null> {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as T | null
  let data: { value: unknown } | null
  try {
    data = await prisma.platform_settings.findUnique({ where: { key }, select: { value: true } })
  } catch (err) {
    // Table missing (migration not applied) or DB down: behave as unset.
    console.warn(`[platform-settings] read "${key}" failed:`, err instanceof Error ? err.message : err)
    return null
  }
  const value = (data?.value ?? null) as T | null
  cache.set(key, { at: Date.now(), value })
  return value
}

export async function setPlatformSetting(key: string, value: object, userId: string | null): Promise<void> {
  const row = { value: value as Prisma.InputJsonValue, updated_by: userId, updated_at: new Date() }
  await prisma.platform_settings.upsert({ where: { key }, create: { key, ...row }, update: row })
  cache.delete(key)
}

// ------------------------------------------------------------
// AI providers
// ------------------------------------------------------------
export const AI_PROVIDERS = ['gemini', 'deepseek', 'openai'] as const
export type AiProvider = (typeof AI_PROVIDERS)[number]

export const AI_ENV_KEY: Record<AiProvider, string> = {
  gemini: 'GEMINI_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  openai: 'OPENAI_API_KEY',
}

/** Stored shape of platform_settings['ai']. Keys are encrypted. */
export interface StoredAiSettings {
  provider_order?: AiProvider[]
  models?: Partial<Record<AiProvider, string>>
  keys?: Partial<Record<AiProvider, string>>
  deepseek_base_url?: string
}

/** What the LLM client uses: decrypted keys, effective order and models. */
export interface AiConfig {
  keys: Partial<Record<AiProvider, string>>
  order: AiProvider[]
  models: Partial<Record<AiProvider, string>>
  deepseekBaseUrl: string
  /** Where each key came from (for the admin UI). */
  sources: Partial<Record<AiProvider, 'panel' | 'env'>>
}

const DEFAULT_ORDER: AiProvider[] = ['gemini', 'deepseek', 'openai']

function isProvider(p: unknown): p is AiProvider {
  return typeof p === 'string' && (AI_PROVIDERS as readonly string[]).includes(p)
}

export function normalizeOrder(order: unknown): AiProvider[] {
  const list = Array.isArray(order) ? order.filter(isProvider) : []
  const unique = [...new Set(list)]
  return [...unique, ...DEFAULT_ORDER.filter((p) => !unique.includes(p))]
}

/** Pure merge of stored settings and env (panel wins). */
export function buildAiConfig(stored: StoredAiSettings | null, env: Record<string, string | undefined>): AiConfig {
  const keys: AiConfig['keys'] = {}
  const sources: AiConfig['sources'] = {}
  for (const p of AI_PROVIDERS) {
    const enc = stored?.keys?.[p]
    let fromPanel: string | undefined
    if (enc) {
      try {
        fromPanel = decrypt(enc)
      } catch {
        console.warn(`[platform-settings] could not decrypt ${p} key (ENCRYPTION_KEY changed?)`)
      }
    }
    if (fromPanel) {
      keys[p] = fromPanel
      sources[p] = 'panel'
    } else if (env[AI_ENV_KEY[p]]) {
      keys[p] = env[AI_ENV_KEY[p]]
      sources[p] = 'env'
    }
  }
  const envOrder = (env.AI_PROVIDER_ORDER ?? '').split(',').map((s) => s.trim().toLowerCase())
  return {
    keys,
    sources,
    order: normalizeOrder(stored?.provider_order?.length ? stored.provider_order : envOrder),
    models: {
      ...(env.DEEPSEEK_MODEL ? { deepseek: env.DEEPSEEK_MODEL } : {}),
      ...(stored?.models ?? {}),
    },
    deepseekBaseUrl: (stored?.deepseek_base_url || env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, ''),
  }
}

export async function getAiConfig(): Promise<AiConfig> {
  return buildAiConfig(await getPlatformSetting<StoredAiSettings>('ai'), process.env)
}

export interface AiSettingsUpdate {
  provider_order?: AiProvider[]
  models?: Partial<Record<AiProvider, string | null>>
  /** string = set/replace, null = remove (falls back to env), undefined = keep */
  keys?: Partial<Record<AiProvider, string | null>>
  deepseek_base_url?: string | null
}

export async function updateAiSettings(update: AiSettingsUpdate, userId: string | null): Promise<void> {
  const current = (await getPlatformSetting<StoredAiSettings>('ai')) ?? {}
  const next: StoredAiSettings = {
    ...current,
    keys: { ...(current.keys ?? {}) },
    models: { ...(current.models ?? {}) },
  }
  if (update.provider_order) next.provider_order = normalizeOrder(update.provider_order)
  for (const p of AI_PROVIDERS) {
    const k = update.keys?.[p]
    if (typeof k === 'string' && k.trim()) next.keys![p] = encrypt(k.trim())
    else if (k === null) delete next.keys![p]
    const m = update.models?.[p]
    if (typeof m === 'string' && m.trim()) next.models![p] = m.trim()
    else if (m === null || m === '') delete next.models![p]
  }
  if (update.deepseek_base_url !== undefined) {
    if (update.deepseek_base_url) next.deepseek_base_url = update.deepseek_base_url.trim()
    else delete next.deepseek_base_url
  }
  await setPlatformSetting('ai', next, userId)
}

/** Masked view for the admin UI: never returns a key. */
export function maskedAiSettings(cfg: AiConfig, stored: StoredAiSettings | null) {
  return {
    provider_order: cfg.order,
    models: stored?.models ?? {},
    deepseek_base_url: stored?.deepseek_base_url ?? '',
    providers: AI_PROVIDERS.map((p) => ({
      id: p,
      configured: !!cfg.keys[p],
      source: cfg.sources[p] ?? null,
      hint: cfg.keys[p] ? `••••${cfg.keys[p]!.slice(-4)}` : null,
    })),
  }
}

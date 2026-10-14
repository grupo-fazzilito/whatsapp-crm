import 'server-only'
import { decrypt, encrypt } from '@/lib/whatsapp/encryption'
import { getPlatformSetting, setPlatformSetting } from '@/lib/platform/settings'
import { normalizeBilling, type BillingSettings } from './pricing'
import { publicPricing, type PublicPricing } from './plans'
import { listPublicPlans } from './plan-store'
import { DEFAULT_PL_BASE_URL, type AmountFormat, type PaymentLatamConfig } from './payment-latam'

// platform_settings 'billing'        → prices and rules (plain JSON)
// platform_settings 'payment_latam'  → gateway credentials (secrets encrypted)
// Env fallback per field: PAYMENT_LATAM_BASE_URL, PAYMENT_LATAM_MERCHANT,
// PAYMENT_LATAM_USER, PAYMENT_LATAM_PASS.

export async function getBillingSettings(): Promise<BillingSettings> {
  return normalizeBilling(await getPlatformSetting<Partial<BillingSettings>>('billing'))
}

/** Plans and token prices for the public pricing pages. */
export async function getPublicPricing(): Promise<PublicPricing> {
  const [settings, plans] = await Promise.all([getBillingSettings(), listPublicPlans()])
  return publicPricing(settings, plans)
}

export async function saveBillingSettings(value: BillingSettings, userId: string | null) {
  await setPlatformSetting('billing', normalizeBilling(value), userId)
}

export interface StoredPaymentLatam {
  base_url?: string
  merchant_code?: string
  /** encrypted */
  secret_user?: string
  /** encrypted */
  secret_pass?: string
  amount_format?: AmountFormat
}

const FORMATS: AmountFormat[] = ['fixed2', 'fixed1', 'plain']

function dec(v: string | undefined): string | null {
  if (!v) return null
  try {
    return decrypt(v)
  } catch {
    console.warn('[billing] could not decrypt a Payment Latam secret (ENCRYPTION_KEY changed?)')
    return null
  }
}

/** Base URL must be https in production (http allowed locally for mocks). */
export function validBaseUrl(url: string, env: Record<string, string | undefined> = process.env): boolean {
  try {
    const u = new URL(url)
    if (u.protocol === 'https:') return true
    return u.protocol === 'http:' && env.NODE_ENV !== 'production'
  } catch {
    return false
  }
}

export function buildPaymentLatamConfig(stored: StoredPaymentLatam | null, env: Record<string, string | undefined>): PaymentLatamConfig | null {
  const baseUrl = [stored?.base_url, env.PAYMENT_LATAM_BASE_URL].find((u) => !!u && validBaseUrl(u, env)) ?? DEFAULT_PL_BASE_URL
  const merchantCode = stored?.merchant_code || env.PAYMENT_LATAM_MERCHANT || ''
  const secretUser = dec(stored?.secret_user) || env.PAYMENT_LATAM_USER || ''
  const secretPass = dec(stored?.secret_pass) || env.PAYMENT_LATAM_PASS || ''
  if (!merchantCode || !secretUser || !secretPass) return null
  const amountFormat = FORMATS.includes(stored?.amount_format as AmountFormat) ? (stored!.amount_format as AmountFormat) : 'fixed2'
  return { baseUrl, merchantCode, secretUser, secretPass, amountFormat }
}

export async function getPaymentLatamConfig(): Promise<PaymentLatamConfig | null> {
  return buildPaymentLatamConfig(await getPlatformSetting<StoredPaymentLatam>('payment_latam'), process.env)
}

export interface PaymentLatamUpdate {
  base_url?: string | null
  merchant_code?: string | null
  secret_user?: string | null
  secret_pass?: string | null
  amount_format?: AmountFormat
}

export async function updatePaymentLatam(update: PaymentLatamUpdate, userId: string | null) {
  const next: StoredPaymentLatam = { ...((await getPlatformSetting<StoredPaymentLatam>('payment_latam')) ?? {}) }
  for (const k of ['base_url', 'merchant_code'] as const) {
    const v = update[k]
    if (v === null) delete next[k]
    else if (typeof v === 'string' && v.trim()) next[k] = v.trim()
  }
  for (const k of ['secret_user', 'secret_pass'] as const) {
    const v = update[k]
    if (v === null) delete next[k]
    else if (typeof v === 'string' && v.trim()) next[k] = encrypt(v.trim())
  }
  if (update.amount_format && FORMATS.includes(update.amount_format)) next.amount_format = update.amount_format
  await setPlatformSetting('payment_latam', next, userId)
}

const hint = (v: string | null) => (v ? `••••${v.slice(-3)}` : null)

/** Admin view: secrets are never returned, only a hint. */
export async function maskedPaymentLatam() {
  const stored = await getPlatformSetting<StoredPaymentLatam>('payment_latam')
  const cfg = buildPaymentLatamConfig(stored, process.env)
  return {
    configured: !!cfg,
    base_url: stored?.base_url ?? '',
    effective_base_url: cfg?.baseUrl ?? (stored?.base_url || process.env.PAYMENT_LATAM_BASE_URL || DEFAULT_PL_BASE_URL),
    merchant_code: stored?.merchant_code ?? '',
    user_hint: hint(dec(stored?.secret_user)),
    pass_hint: stored?.secret_pass ? '••••••' : null,
    amount_format: cfg?.amountFormat ?? stored?.amount_format ?? 'fixed2',
    env_fallback: !stored?.secret_user && !!process.env.PAYMENT_LATAM_USER,
  }
}

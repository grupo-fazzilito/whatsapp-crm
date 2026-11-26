// The credit plan: base_price buys step_tokens credits a month; extra credits
// cost step_price per step_tokens, prorated. Prices in dollars (Stripe, every
// region but Peru) and in soles (Peru, charged with Culqi): US$ 9.90 + US$ 3,
// S/ 39.90 + S/ 14.90. Edited in the admin billing settings. Pure — safe on the client.

export interface SubscriptionPricing {
  currency: 'USD' | 'PEN'
  /** Tokens per step (and the smallest plan). */
  step_tokens: number
  /** Price of the first step, in dollars. */
  base_price: number
  /** Price of each extra step, in dollars. */
  step_price: number
  /** Largest plan on the slider (more: talk to us). */
  max_tokens: number
  /** Peru (Culqi, soles): price of the plan and of each extra step_tokens. */
  pen_base_price: number
  pen_step_price: number
}

export const DEFAULT_SUBSCRIPTION: SubscriptionPricing = {
  currency: 'USD',
  step_tokens: 1000,
  base_price: 9.9,
  step_price: 3,
  max_tokens: 100_000,
  pen_base_price: 39.9,
  pen_step_price: 14.9,
}

const num = (v: unknown, min: number, max: number, fallback: number) => {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max ? n : fallback
}

export function normalizeSubscription(s: Partial<SubscriptionPricing> | null | undefined): SubscriptionPricing {
  const v = s ?? {}
  const step_tokens = Math.round(num(v.step_tokens, 100, 100_000, DEFAULT_SUBSCRIPTION.step_tokens))
  const max = Math.round(num(v.max_tokens, step_tokens, 10_000_000, DEFAULT_SUBSCRIPTION.max_tokens))
  return {
    currency: 'USD',
    step_tokens,
    base_price: Math.round(num(v.base_price, 0.5, 100_000, DEFAULT_SUBSCRIPTION.base_price) * 100) / 100,
    step_price: Math.round(num(v.step_price, 0, 100_000, DEFAULT_SUBSCRIPTION.step_price) * 100) / 100,
    // A whole number of steps.
    max_tokens: Math.max(step_tokens, Math.floor(max / step_tokens) * step_tokens),
    pen_base_price: Math.round(num(v.pen_base_price, 0.5, 1_000_000, DEFAULT_SUBSCRIPTION.pen_base_price) * 100) / 100,
    pen_step_price: Math.round(num(v.pen_step_price, 0, 1_000_000, DEFAULT_SUBSCRIPTION.pen_step_price) * 100) / 100,
  }
}

/** A valid plan size (whole steps, between one step and the max), or null. */
export function validTokens(raw: unknown, p: SubscriptionPricing): number | null {
  const n = typeof raw === 'string' ? Number(raw) : raw
  if (typeof n !== 'number' || !Number.isInteger(n) || n < p.step_tokens || n > p.max_tokens || n % p.step_tokens !== 0) return null
  return n
}

/** Monthly price in cents: base for the first step, plus the step price for each one after it. */
export function monthlyCents(tokens: number, p: SubscriptionPricing): number {
  const steps = Math.max(1, Math.round(tokens / p.step_tokens))
  return Math.round(p.base_price * 100) + (steps - 1) * Math.round(p.step_price * 100)
}

/** "US$ 21.90" */
export function formatUsdCents(cents: number): string {
  return `US$ ${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// One plan: base_price buys step_tokens credits a month. When they run out,
// extra credits are handed out up to the business's limit and only the ones
// used are billed, prorated at step_price per step_tokens (US$ 3 per 1,000:
// 100 credits = US$ 0.30), on the next invoice.

/** Extra-credit limit: the slider goes up to 9 × step_tokens; a business may type up to OVERAGE_MAX_STEPS. */
export const OVERAGE_SLIDER_STEPS = 9
export const OVERAGE_MAX_STEPS = 1000
export const DEFAULT_OVERAGE_STEPS = 9

/** Default extra-credit limit (9,000 credits). */
export function defaultOverageLimit(p: SubscriptionPricing): number {
  return DEFAULT_OVERAGE_STEPS * p.step_tokens
}

/** A valid extra-credit limit (whole steps, 1 to OVERAGE_MAX_STEPS), or null. */
export function validOverageLimit(raw: unknown, p: SubscriptionPricing): number | null {
  const n = typeof raw === 'string' ? Number(raw) : raw
  if (typeof n !== 'number' || !Number.isInteger(n) || n < p.step_tokens || n > OVERAGE_MAX_STEPS * p.step_tokens || n % p.step_tokens !== 0) return null
  return n
}

/** What `credits` extra credits cost, in cents (prorated, rounded to the cent). */
export function overageCentsFor(credits: number, p: SubscriptionPricing): number {
  if (credits <= 0 || p.step_tokens <= 0) return 0
  return Math.round((credits * Math.round(p.step_price * 100)) / p.step_tokens)
}

/**
 * Who charges the plan. Whasalia sells in Peru only (2026-11-26): always
 * Culqi, in soles. Stripe (dollars) stays wired for a future brand.
 */
export type SubscriptionProvider = 'stripe' | 'culqi'
export function subscriptionProvider(_region?: string | null): SubscriptionProvider {
  void _region
  return 'culqi'
}

/** The plan's prices in the currency a provider charges (soles for Culqi). */
export function pricingForProvider(p: SubscriptionPricing, provider: SubscriptionProvider): SubscriptionPricing {
  if (provider !== 'culqi') return { ...p, currency: 'USD' }
  return { ...p, currency: 'PEN', base_price: p.pen_base_price, step_price: p.pen_step_price }
}

/** "S/ 39.90" or "US$ 9.90". */
export function formatPlanCents(cents: number, currency: string): string {
  const n = (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return currency === 'PEN' ? `S/ ${n}` : `US$ ${n}`
}

// AI tokens by monthly subscription: the CRM is free; a business picks how
// many tokens it wants per month, in steps of 1,000. The first 1,000 cost the
// base price and each extra 1,000 adds the step price (US$ 9.90 + US$ 3 each).
// Edited in the admin billing settings. Pure — safe on the client.

export interface SubscriptionPricing {
  currency: 'USD'
  /** Tokens per step (and the smallest plan). */
  step_tokens: number
  /** Price of the first step, in dollars. */
  base_price: number
  /** Price of each extra step, in dollars. */
  step_price: number
  /** Largest plan on the slider (more: talk to us). */
  max_tokens: number
}

export const DEFAULT_SUBSCRIPTION: SubscriptionPricing = {
  currency: 'USD',
  step_tokens: 1000,
  base_price: 9.9,
  step_price: 3,
  max_tokens: 100_000,
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

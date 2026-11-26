import { describe, expect, it } from 'vitest'
import { DEFAULT_SUBSCRIPTION, formatUsdCents, monthlyCents, normalizeSubscription, validTokens } from './subscription-pricing'

describe('token subscription prices', () => {
  const p = DEFAULT_SUBSCRIPTION

  it('charges US$ 9.90 for the first 1,000 and US$ 3 for each 1,000 more', () => {
    expect(monthlyCents(1000, p)).toBe(990)
    expect(monthlyCents(2000, p)).toBe(1290)
    expect(monthlyCents(5000, p)).toBe(2190)
    expect(monthlyCents(100_000, p)).toBe(990 + 99 * 300)
    expect(formatUsdCents(2190)).toBe('US$ 21.90')
  })

  it('takes whole thousands between 1,000 and the maximum only', () => {
    expect(validTokens(3000, p)).toBe(3000)
    expect(validTokens('3000', p)).toBe(3000)
    expect(validTokens(1500, p)).toBeNull()
    expect(validTokens(0, p)).toBeNull()
    expect(validTokens(200_000, p)).toBeNull()
    expect(validTokens('x', p)).toBeNull()
  })

  it('cleans admin settings', () => {
    expect(normalizeSubscription(null)).toEqual(DEFAULT_SUBSCRIPTION)
    expect(normalizeSubscription({ base_price: 12.345, step_price: -1, step_tokens: 1000, max_tokens: 50_500 })).toEqual({
      currency: 'USD', step_tokens: 1000, base_price: 12.35, step_price: 3, max_tokens: 50_000, pen_base_price: 39.9, pen_step_price: 14.9,
    })
  })
})

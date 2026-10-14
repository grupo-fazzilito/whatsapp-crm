import { describe, expect, it } from 'vitest'
import { formatSoles, planFromRow, publicPricing } from './plans'
import { normalizeBilling } from './pricing'

describe('plans', () => {
  it('reads a plans row (Decimal price, json features)', () => {
    expect(planFromRow({ id: 'free', name: 'Free Forever', price_monthly: '0.00', currency: 'PEN', features: ['crm', 3, 'api'] })).toEqual({
      id: 'free', name: 'Free Forever', price: 0, currency: 'PEN', features: ['crm', 'api'],
    })
    expect(planFromRow({ id: 'pro', name: 'Pro', price_monthly: '49.90', currency: 'PEN', features: null }).price).toBe(49.9)
  })

  it('builds the public pricing from the billing settings', () => {
    const settings = normalizeBilling({ credit_price: 0.05, min_topup: 50, packs: [100, 50], welcome_credits: 100, expiry_months: 6 })
    const free = planFromRow({ id: 'free', name: 'Free Forever', price_monthly: 0, currency: 'PEN', features: [] })
    const p = publicPricing(settings, [free])
    expect(p.plans).toEqual([free])
    expect(p.credits.packs).toEqual([{ amount: 50, credits: 1000 }, { amount: 100, credits: 2000 }])
    expect(p.credits).toMatchObject({ price: 0.05, minTopup: 50, welcome: 100, expiryMonths: 6 })
    // The agent playground is internal, not a customer-facing cost.
    expect(p.credits.costs.map((c) => c.action)).not.toContain('playground')
    expect(p.credits.costs.find((c) => c.action === 'transcription')?.credits).toBe(2)
  })

  it('formats soles', () => {
    expect(formatSoles(0)).toBe('S/ 0')
    expect(formatSoles(50)).toBe('S/ 50')
    expect(formatSoles(0.05)).toBe('S/ 0.05')
    expect(formatSoles(0.025)).toBe('S/ 0.025')
    expect(formatSoles(1500)).toBe('S/ 1,500')
  })
})

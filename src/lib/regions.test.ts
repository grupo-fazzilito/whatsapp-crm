import { describe, expect, it } from 'vitest'
import { formatMoney, isRegion, regionForCountry } from './regions'
import { DEFAULT_BILLING, checkTopup, normalizeBilling, pricingFor } from './billing/pricing'
import { publicPricing } from './billing/plans'

describe('regions', () => {
  it('sends Peru and Venezuela to their own region and everyone else to the US', () => {
    expect(regionForCountry('PE')).toBe('pe')
    expect(regionForCountry('ve')).toBe('ve')
    expect(regionForCountry('US')).toBe('us')
    expect(regionForCountry('CO')).toBe('us')
    expect(regionForCountry('XX')).toBe('us')
    expect(regionForCountry(null)).toBe('us')
  })

  it('knows its regions', () => {
    expect(isRegion('pe')).toBe(true)
    expect(isRegion('cl')).toBe(false)
    expect(isRegion(undefined)).toBe(false)
  })

  it('formats prices in the region currency', () => {
    expect(formatMoney(50, 'PEN')).toBe('S/ 50')
    expect(formatMoney(0.015, 'USD')).toBe('US$ 0.015')
    expect(formatMoney(1500, 'USD')).toBe('US$ 1,500')
  })
})

describe('prices by region', () => {
  it('keeps Peru in soles and gives the other regions dollar prices', () => {
    const s = normalizeBilling(null)
    expect(pricingFor(s, 'pe')).toMatchObject({ currency: 'PEN', credit_price: DEFAULT_BILLING.credit_price, min_topup: DEFAULT_BILLING.min_topup })
    expect(pricingFor(s, 've')).toMatchObject({ currency: 'USD', credit_price: 0.015, min_topup: 15 })
    expect(pricingFor(s, 'us').packs).toEqual([15, 30, 60, 150])
  })

  it('cleans stored region prices like Peru’s', () => {
    const s = normalizeBilling({ regions: { us: { credit_price: 0.02, min_topup: 10, packs: [5, 20, 10, 20] }, ve: { credit_price: -1, min_topup: 0, packs: [] } } } as never)
    expect(s.regions.us).toEqual({ credit_price: 0.02, min_topup: 10, packs: [10, 20] })
    expect(s.regions.ve).toEqual({ credit_price: 0.015, min_topup: 15, packs: [15] })
  })

  it('checks a top-up against the region minimum', () => {
    const us = pricingFor(normalizeBilling(null), 'us')
    expect(checkTopup(10, us)).toEqual({ ok: false, error: 'below_minimum' })
    expect(checkTopup(30, us)).toEqual({ ok: true, amount: 30, credits: 2000 })
  })

  it('shows public prices in the visitor’s region', () => {
    const p = publicPricing(normalizeBilling(null), [], 'us')
    expect(p).toMatchObject({ region: 'us', currency: 'USD' })
    expect(p.credits.packs[0]).toEqual({ amount: 15, credits: 1000 })
  })
})

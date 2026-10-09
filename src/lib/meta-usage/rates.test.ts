import { describe, expect, it } from 'vitest'
import { estimateNumber, monthBounds, projectMonth, ratesFor } from './rates'

const usage = (o: Partial<Record<'service' | 'marketing' | 'utility' | 'authentication' | 'other_template', number>>) => ({
  service: 0, marketing: 0, utility: 0, authentication: 0, other_template: 0, ...o,
})

describe('Meta usage estimate', () => {
  it('the first 1,000 service messages of each number are free', () => {
    const { rates, freePerNumber } = ratesFor('PE')
    expect(estimateNumber(usage({ service: 800 }), rates, freePerNumber)).toMatchObject({ freeUsed: 800, freeLeft: 200, billableService: 0, costUsd: { total: 0 } })
    const e = estimateNumber(usage({ service: 1250 }), rates, freePerNumber)
    expect(e).toMatchObject({ freeUsed: 1000, freeLeft: 0, billableService: 250 })
    expect(e.costUsd.service).toBeCloseTo(7.5)
  })
  it('templates are always billed by category (unknown → utility rate)', () => {
    const { rates } = ratesFor('PE')
    const e = estimateNumber(usage({ marketing: 100, utility: 10, authentication: 5, other_template: 5 }), rates, 1000)
    expect(e.costUsd.marketing).toBeCloseTo(7.03)
    expect(e.costUsd.utility).toBeCloseTo(0.45)
    expect(e.costUsd.authentication).toBeCloseTo(0.15)
    expect(e.costUsd.total).toBeCloseTo(7.63)
  })
  it('picks the market rates, falls back to "other", and honours overrides', () => {
    expect(ratesFor('mx').market).toBe('MX')
    expect(ratesFor('CL').market).toBe('other')
    expect(ratesFor(null).rates.service).toBe(0.0077)
    const o = ratesFor('PE', { free_service_per_number: 500, rates: { PE: { service: 0.02 } } })
    expect(o).toMatchObject({ freePerNumber: 500, rates: { service: 0.02, marketing: 0.0703 } })
    expect(ratesFor('CL', { rates: { CL: { service: 0.01 } } })).toMatchObject({ market: 'CL', rates: { service: 0.01, marketing: 0.0604 } })
  })
  it('month bounds and projection', () => {
    const b = monthBounds('2026-10')!
    expect(b.since.toISOString()).toBe('2026-10-01T00:00:00.000Z')
    expect(b.until.toISOString()).toBe('2026-11-01T00:00:00.000Z')
    expect(monthBounds('2026-13')).toBeNull()
    expect(monthBounds(null, new Date('2026-02-10T00:00:00Z'))!.month).toBe('2026-02')
    // 300 messages after 10 of 31 days → ~930 by month end
    expect(projectMonth(300, b.since, b.until, new Date('2026-10-11T00:00:00Z'))).toBe(930)
    expect(projectMonth(300, b.since, b.until, new Date('2026-12-01T00:00:00Z'))).toBe(300)
  })
})

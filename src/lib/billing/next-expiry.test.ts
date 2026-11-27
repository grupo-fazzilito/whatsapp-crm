import { describe, expect, it } from 'vitest'
import { nextExpiryView } from './next-expiry'

const lot = { expires_at: '2026-12-30T23:00:00Z', credits_remaining: 1000, source: 'subscription' }
const sub = { status: 'active', current_period_end: '2026-12-28T00:30:00Z', cancel_at_period_end: false }

describe('next credits expiry shown', () => {
  it("shows the renewal date for the plan's credits", () => {
    expect(nextExpiryView(lot, sub)).toEqual({ at: '2026-12-28T00:30:00.000Z', credits: 1000, renews: true })
  })
  it('says they end (not renew) when the plan is cancelled', () => {
    expect(nextExpiryView(lot, { ...sub, cancel_at_period_end: true })).toMatchObject({ at: '2026-12-28T00:30:00.000Z', renews: false })
  })
  it('keeps the real expiry for other credits or without an active plan', () => {
    expect(nextExpiryView({ ...lot, source: 'welcome' }, sub)).toMatchObject({ at: '2026-12-30T23:00:00.000Z', renews: false })
    expect(nextExpiryView(lot, { ...sub, status: 'canceled' })).toMatchObject({ at: '2026-12-30T23:00:00.000Z', renews: false })
    expect(nextExpiryView(null, sub)).toBeNull()
  })
})

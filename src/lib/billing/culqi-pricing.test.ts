import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { DEFAULT_SUBSCRIPTION, formatPlanCents, monthlyCents, overageCentsFor, pricingForProvider, subscriptionProvider } from './subscription-pricing'
import { customerPayload } from './culqi'

describe('the plan in soles (Peru, Culqi)', () => {
  const pen = pricingForProvider(DEFAULT_SUBSCRIPTION, subscriptionProvider('us'))

  it('every business is charged with Culqi, in soles', () => {
    expect(subscriptionProvider('pe')).toBe('culqi')
    expect(subscriptionProvider(null)).toBe('culqi')
    expect(pen.currency).toBe('PEN')
  })

  it('S/ 39.90 a month; extra credits S/ 14.90 per 1,000, prorated', () => {
    expect(monthlyCents(pen.step_tokens, pen)).toBe(3990)
    expect(formatPlanCents(3990, 'PEN')).toBe('S/ 39.90')
    expect(overageCentsFor(1000, pen)).toBe(1490)
    expect(overageCentsFor(100, pen)).toBe(149)
    expect(overageCentsFor(9000, pen)).toBe(13410)
    expect(overageCentsFor(0, pen)).toBe(0)
  })
})

describe('Culqi customer', () => {
  it('sends the fields Culqi asks for, cleaned', () => {
    expect(
      customerPayload({ firstName: 'Peluquería', lastName: 'Sol S.A.C. 2', email: 'a@b.pe', address: '  Av.  Larco 123 ', city: 'Lima', phone: '+51 987 654 321' }),
    ).toEqual({ first_name: 'Peluquería', last_name: 'Sol S A C', email: 'a@b.pe', address: 'Av. Larco 123', address_city: 'Lima', country_code: 'PE', phone_number: '987654321' })
  })
})

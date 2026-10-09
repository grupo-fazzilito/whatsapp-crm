import { describe, expect, it } from 'vitest'
import { Prisma } from '@/generated/prisma/client'
import { normalizeArgs, normalizeRaw, normalizeResult } from './compat'

describe('compat', () => {
  it('results look like PostgREST rows', () => {
    const row = {
      id: 'p1',
      amount: new Prisma.Decimal('50.00'),
      credits: 1000,
      expires_on: new Date('2026-10-11T00:00:00Z'),
      created_at: new Date('2026-10-09T14:02:47.725Z'),
      raw: { nested: 1 },
    }
    expect(normalizeResult('billing_payments', row)).toEqual({
      id: 'p1', amount: 50, credits: 1000, expires_on: '2026-10-11', created_at: '2026-10-09T14:02:47.725Z', raw: { nested: 1 },
    })
  })
  it('follows relations and BigInt ids', () => {
    const r = normalizeResult('credit_ledger', [{ id: BigInt(12), created_at: new Date(0), credit_lots: { expires_at: new Date(0), credits_total: 5 } }])
    expect(r).toEqual([{ id: 12, created_at: '1970-01-01T00:00:00.000Z', credit_lots: { expires_at: '1970-01-01T00:00:00.000Z', credits_total: 5 } }])
  })
  it('date strings in filters and data become Dates', () => {
    const a = normalizeArgs('bookings', { where: { booking_date: { gte: '2026-10-01', lte: '2026-10-31' }, status: 'confirmed' }, data: { booking_date: '2026-10-12' } }) as {
      where: { booking_date: { gte: Date; lte: Date }; status: string }
      data: { booking_date: Date }
    }
    expect(a.where.booking_date.gte.toISOString()).toBe('2026-10-01T00:00:00.000Z')
    expect(a.where.status).toBe('confirmed')
    expect(a.data.booking_date).toBeInstanceOf(Date)
    // ISO timestamps pass through untouched
    expect(normalizeArgs('messages', { where: { created_at: { gte: '2026-10-01T00:00:00Z' } } })).toEqual({ where: { created_at: { gte: '2026-10-01T00:00:00Z' } } })
  })
  it('raw rows', () => {
    expect(normalizeRaw([{ n: BigInt(3), d: new Prisma.Decimal('1.5'), t: new Date(0), s: 'x' }])).toEqual([{ n: 3, d: 1.5, t: '1970-01-01T00:00:00.000Z', s: 'x' }])
  })
})

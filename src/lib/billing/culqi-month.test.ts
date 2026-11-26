import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }))
const { addMonth } = await import('./culqi-subscriptions')

describe('addMonth', () => {
  it('same day next month, clamped to the last day', () => {
    expect(addMonth(new Date('2026-11-26T15:00:00Z')).toISOString()).toBe('2026-12-26T15:00:00.000Z')
    expect(addMonth(new Date('2027-01-31T10:00:00Z')).toISOString()).toBe('2027-02-28T10:00:00.000Z')
    expect(addMonth(new Date('2026-12-15T00:00:00Z')).toISOString()).toBe('2027-01-15T00:00:00.000Z')
  })
})

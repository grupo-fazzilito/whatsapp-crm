import { describe, expect, it } from 'vitest'
import { cycleBounds } from './cycle'

const iso = (d: Date) => d.toISOString()

describe('monthly cycle from the signup date', () => {
  const signup = new Date('2026-09-12T15:30:00Z')
  it('runs from the 12th to the 12th', () => {
    const c = cycleBounds(signup, new Date('2026-11-27T10:00:00Z'))
    expect(iso(c.start)).toBe('2026-11-12T15:30:00.000Z')
    expect(iso(c.next)).toBe('2026-12-12T15:30:00.000Z')
  })
  it('a moment before the anniversary is still the previous cycle', () => {
    const c = cycleBounds(signup, new Date('2026-11-12T15:29:00Z'))
    expect(iso(c.start)).toBe('2026-10-12T15:30:00.000Z')
  })
  it('the first month starts at signup', () => {
    const c = cycleBounds(signup, new Date('2026-09-20T00:00:00Z'))
    expect(iso(c.start)).toBe('2026-09-12T15:30:00.000Z')
    expect(iso(c.next)).toBe('2026-10-12T15:30:00.000Z')
  })
  it('signed up on the 31st: short months use their last day', () => {
    const c = cycleBounds(new Date('2026-01-31T12:00:00Z'), new Date('2026-03-05T00:00:00Z'))
    expect(iso(c.start)).toBe('2026-02-28T12:00:00.000Z')
    expect(iso(c.next)).toBe('2026-03-31T12:00:00.000Z')
  })
  it('crosses the year', () => {
    const c = cycleBounds(new Date('2025-12-20T00:00:00Z'), new Date('2026-01-25T00:00:00Z'))
    expect(iso(c.start)).toBe('2026-01-20T00:00:00.000Z')
    expect(iso(c.next)).toBe('2026-02-20T00:00:00.000Z')
  })
})

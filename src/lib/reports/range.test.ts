import { describe, expect, it } from 'vitest'
import { daySpan, resolveRange } from './range'

// 2026-10-08 03:30 UTC = 2026-10-07 22:30 in Lima (UTC-5).
const NOW = new Date('2026-10-08T03:30:00Z')

describe('resolveRange', () => {
  it('uses the workspace zone for "today"', () => {
    const r = resolveRange('today', 'America/Lima', NOW)!
    expect(r.fromDate).toBe('2026-10-07')
    expect(r.toDate).toBe('2026-10-07')
    expect(r.from.toISOString()).toBe('2026-10-07T05:00:00.000Z')
    expect(r.to.toISOString()).toBe('2026-10-08T05:00:00.000Z')
    expect(r.days).toEqual(['2026-10-07'])
  })
  it('7d / 30d include today', () => {
    expect(resolveRange('7d', 'America/Lima', NOW)!.days).toHaveLength(7)
    const r = resolveRange('30d', 'America/Lima', NOW)!
    expect(r.days).toHaveLength(30)
    expect(r.fromDate).toBe('2026-09-08')
  })
  it('month starts on the 1st', () => {
    const r = resolveRange('month', 'UTC', NOW)!
    expect(r.fromDate).toBe('2026-10-01')
    expect(r.toDate).toBe('2026-10-08')
  })
  it('validates custom ranges', () => {
    expect(resolveRange('custom', 'UTC', NOW, { from: '2026-10-05', to: '2026-10-01' })).toBeNull()
    expect(resolveRange('custom', 'UTC', NOW, { from: 'x', to: '2026-10-01' })).toBeNull()
    expect(resolveRange('custom', 'UTC', NOW, { from: '2024-01-01', to: '2026-01-01' })).toBeNull()
    const r = resolveRange('custom', 'America/Lima', NOW, { from: '2026-09-01', to: '2026-09-30' })!
    expect(r.days).toHaveLength(30)
    expect(r.to.toISOString()).toBe('2026-10-01T05:00:00.000Z')
  })
  it('falls back to UTC for a bad zone', () => {
    expect(resolveRange('today', 'Not/AZone', NOW)!.timeZone).toBe('UTC')
  })
  it('daySpan is inclusive', () => {
    expect(daySpan('2026-10-01', '2026-10-01')).toBe(1)
    expect(daySpan('2026-02-27', '2026-03-01')).toBe(3)
  })
})

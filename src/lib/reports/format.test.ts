import { describe, expect, it } from 'vitest'
import { formatDuration, formatPercent, minutesValue, niceTicks, shortDay } from './format'

describe('format', () => {
  it('formats durations compactly', () => {
    expect(formatDuration(null)).toBe('—')
    expect(formatDuration(45_000)).toBe('45 s')
    expect(formatDuration(4 * 60_000)).toBe('4 min')
    expect(formatDuration(80 * 60_000)).toBe('1 h 20 min')
    expect(formatDuration(120 * 60_000)).toBe('2 h')
    expect(formatDuration(51 * 3_600_000)).toBe('2 d 3 h')
  })
  it('minutes for CSV', () => {
    expect(minutesValue(750_000)).toBe(12.5)
    expect(minutesValue(null)).toBeNull()
  })
  it('percent', () => {
    expect(formatPercent(0.5, 'es-PE')).toMatch(/50\s?%/)
    expect(formatPercent(null, 'es')).toBe('—')
  })
  it('short day label is zone-independent', () => {
    expect(shortDay('2026-10-01', 'en')).toBe('Oct 1')
  })
  it('nice ticks cover the max', () => {
    expect(niceTicks(0)).toEqual([0, 1])
    expect(niceTicks(7)).toEqual([0, 2, 4, 6, 8])
    expect(niceTicks(100)).toEqual([0, 25, 50, 75, 100])
    const t = niceTicks(1234)
    expect(t[t.length - 1]).toBeGreaterThanOrEqual(1234)
  })
})

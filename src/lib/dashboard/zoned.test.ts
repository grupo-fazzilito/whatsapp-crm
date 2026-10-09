import { describe, expect, it } from 'vitest'
import {
  safeTimeZone,
  zonedDayKey,
  zonedDaysAgoStart,
  zonedLastNDayKeys,
  zonedMondayIndex,
} from './zoned'

describe('zoned calendar helpers', () => {
  it('validates time zones', () => {
    expect(safeTimeZone('America/Bogota')).toBe('America/Bogota')
    expect(safeTimeZone('Not/AZone')).toBe('UTC')
    expect(safeTimeZone(null)).toBe('UTC')
  })

  it('computes local midnight in a fixed-offset zone', () => {
    // 02:00 UTC on the 10th is still the 9th in Bogotá (UTC-5).
    const now = new Date('2026-10-10T02:00:00Z')
    expect(zonedDaysAgoStart(0, 'America/Bogota', now).toISOString()).toBe('2026-10-09T05:00:00.000Z')
    expect(zonedDaysAgoStart(1, 'America/Bogota', now).toISOString()).toBe('2026-10-08T05:00:00.000Z')
    expect(zonedDayKey(now, 'America/Bogota')).toBe('2026-10-09')
    expect(zonedDayKey(now, 'UTC')).toBe('2026-10-10')
  })

  it('handles DST transitions', () => {
    // US DST ended 2026-11-01: midnight before is UTC-4, after is UTC-5.
    const now = new Date('2026-11-02T15:00:00Z')
    expect(zonedDaysAgoStart(0, 'America/New_York', now).toISOString()).toBe('2026-11-02T05:00:00.000Z')
    expect(zonedDaysAgoStart(2, 'America/New_York', now).toISOString()).toBe('2026-10-31T04:00:00.000Z')
  })

  it('lists the last n day keys oldest first, across month ends', () => {
    const now = new Date('2026-03-01T12:00:00Z')
    expect(zonedLastNDayKeys(3, 'UTC', now)).toEqual(['2026-02-27', '2026-02-28', '2026-03-01'])
  })

  it('weekday index is Monday-first in the zone', () => {
    // 2026-10-12 03:00Z is Monday in UTC and Sunday night in Bogotá.
    const d = new Date('2026-10-12T03:00:00Z')
    expect(zonedMondayIndex(d, 'UTC')).toBe(0)
    expect(zonedMondayIndex(d, 'America/Bogota')).toBe(6)
  })
})

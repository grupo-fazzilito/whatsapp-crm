import { describe, expect, it } from 'vitest'
import { reportSettings } from './settings'

describe('reportSettings', () => {
  it('defaults to 15 min and 3.75 for PEN', () => {
    expect(reportSettings({ currency: 'PEN', settings: {} })).toEqual({ slaMinutes: 15, usdRate: 3.75 })
    expect(reportSettings({ currency: 'USD' })).toEqual({ slaMinutes: 15, usdRate: 1 })
    expect(reportSettings({ currency: 'COP' }).usdRate).toBeNull()
  })
  it('reads configured values and rejects invalid ones', () => {
    expect(reportSettings({ currency: 'PEN', settings: { reports: { sla_minutes: 30, usd_rate: 3.8 } } })).toEqual({ slaMinutes: 30, usdRate: 3.8 })
    expect(reportSettings({ currency: 'PEN', settings: { reports: { sla_minutes: 0, usd_rate: -1 } } })).toEqual({ slaMinutes: 15, usdRate: 3.75 })
    expect(reportSettings({ currency: 'PEN', settings: { reports: { sla_minutes: 2.5, usd_rate: 'x' } } }).slaMinutes).toBe(15)
  })
})

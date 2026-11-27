import { describe, expect, it } from 'vitest'
import { calendarMode, pickConnection } from './mode'

describe('calendar mode', () => {
  it('is the business calendar without the professionals module', () => {
    expect(calendarMode('generic', { modules: { staff: false } })).toBe('business')
    expect(calendarMode('generic', { modules: { staff: false }, calendar_mode: 'staff' })).toBe('business')
  })
  it('lets a business with professionals choose; individual by default', () => {
    expect(calendarMode('generic', { modules: { staff: true } })).toBe('staff')
    expect(calendarMode('generic', { modules: { staff: true }, calendar_mode: 'business' })).toBe('business')
  })
  it('sends a booking to the chosen calendar only', () => {
    const conns = [{ id: 'b', staff_id: null }, { id: 's1', staff_id: 's1' }]
    expect(pickConnection('business', conns, 's1')?.id).toBe('b')
    expect(pickConnection('staff', conns, 's1')?.id).toBe('s1')
    expect(pickConnection('staff', conns, 's2')).toBeNull()
    expect(pickConnection('staff', conns, null)).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import { businessWindows, freeSlotsForBusiness, freeSlotsForStaff, type BusinessHoursRow, type StaffRow, type SlotQuery } from './slots'
import { zonedNow } from './time'

// 2026-10-12 is a Monday.
const MON = '2026-10-12'
const hours: BusinessHoursRow[] = [
  { day_name: 'Monday', opening_time: '09:00', closing_time: '14:00', is_closed: false, break_start: '11:00', break_end: '12:00' },
  { day_name: 'Sunday', opening_time: null, closing_time: null, is_closed: true, break_start: null, break_end: null },
]
const barber: StaffRow = {
  id: 's1',
  name: 'Luis',
  available_days: ['Monday'],
  available_start_time: '09:00',
  available_end_time: '14:00',
  weekly_slots: null,
  date_exceptions: null,
}
const base: SlotQuery = { hours, exceptions: [], bookings: [], today: '2026-10-10', nowTime: '10:00', durationMinutes: 60, stepMinutes: 30 }

describe('businessWindows', () => {
  it('splits the day around the break', () => {
    expect(businessWindows(MON, hours, [])).toEqual([
      { start: 540, end: 660 },
      { start: 720, end: 840 },
    ])
  })
  it('honors closed days and closed exceptions', () => {
    expect(businessWindows('2026-10-11', hours, [])).toBeNull()
    expect(businessWindows(MON, hours, [{ date: MON, is_closed: true }])).toBeNull()
  })
})

describe('freeSlotsForStaff', () => {
  it('only offers starts where the whole service fits (no crossing the break)', () => {
    expect(freeSlotsForStaff(barber, MON, base)).toEqual(['09:00', '09:30', '10:00', '12:00', '12:30', '13:00'])
  })

  it('blocks overlapping times using each booking duration', () => {
    const slots = freeSlotsForStaff(barber, MON, {
      ...base,
      bookings: [{ staff_id: 's1', booking_date: MON, booking_time: '09:30', duration_minutes: 30, status: 'confirmed' }],
    })
    // 09:00 (would overlap 09:30–10:00) and 09:30 are gone; 10:00 is free.
    expect(slots.slice(0, 2)).toEqual(['10:00', '12:00'])
  })

  it('ignores cancelled bookings and other staff', () => {
    const slots = freeSlotsForStaff(barber, MON, {
      ...base,
      bookings: [
        { staff_id: 's1', booking_date: MON, booking_time: '09:00', duration_minutes: 60, status: 'cancelled' },
        { staff_id: 's2', booking_date: MON, booking_time: '09:00', duration_minutes: 60, status: 'confirmed' },
      ],
    })
    expect(slots[0]).toBe('09:00')
  })

  it('drops past times today', () => {
    expect(freeSlotsForStaff(barber, MON, { ...base, today: MON, nowTime: '12:10' })).toEqual(['12:30', '13:00'])
  })

  it('uses fixed weekly slots and leave exceptions', () => {
    const fixed: StaffRow = { ...barber, weekly_slots: { Monday: [{ start_time: '09:00' }, { start_time: '13:30', is_active: true }] } }
    // 13:30 + 60 min passes closing (14:00) → excluded.
    expect(freeSlotsForStaff(fixed, MON, base)).toEqual(['09:00'])
    const onLeave: StaffRow = { ...barber, date_exceptions: [{ date: MON, is_available: false }] }
    expect(freeSlotsForStaff(onLeave, MON, base)).toEqual([])
  })
})

describe('freeSlotsForBusiness', () => {
  it('allows up to `capacity` overlapping bookings', () => {
    const q: SlotQuery = {
      ...base,
      durationMinutes: 90,
      capacity: 2,
      bookings: [
        { staff_id: null, booking_date: MON, booking_time: '12:00', duration_minutes: 90, status: 'confirmed' },
        { staff_id: null, booking_date: MON, booking_time: '12:00', duration_minutes: 90, status: 'confirmed' },
      ],
    }
    expect(freeSlotsForBusiness(MON, q)).toEqual(['09:00', '09:30'])
  })
})

describe('zonedNow', () => {
  it('reports the business-local date, not the server one', () => {
    const instant = new Date('2026-10-12T03:30:00Z')
    expect(zonedNow('America/Mexico_City', instant)).toMatchObject({ date: '2026-10-11', time: '21:30', weekday: 'Sunday' })
    expect(zonedNow('Europe/Madrid', instant)).toMatchObject({ date: '2026-10-12', time: '05:30', weekday: 'Monday' })
  })
})

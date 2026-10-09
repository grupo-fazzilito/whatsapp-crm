import { describe, expect, it } from 'vitest'
import {
  InputError,
  mergeSettings,
  parseBooking,
  parseFaq,
  parseHours,
  parsePaymentMethod,
  parseService,
  parseStaff,
  parseWorkspacePatch,
} from './setup-input'

describe('setup input parsers', () => {
  it('keeps only known service columns and requires a name on create', () => {
    expect(parseService({ name: ' Corte ', price: '-3', duration_minutes: 30, workspace_id: 'x', id: 'y' }, false)).toEqual({
      name: 'Corte',
      price: 0,
      duration_minutes: 30,
    })
    expect(() => parseService({ price: 1 }, false)).toThrow(InputError)
    expect(parseService({ is_active: false }, true)).toEqual({ is_active: false })
    expect(() => parseService({ duration_minutes: 2 }, true)).toThrow(/duration_minutes/)
  })

  it('faq agent list: null means every agent', () => {
    expect(parseFaq({ question: 'q', answer: 'a', ai_agent_ids: null }, false)).toEqual({ question: 'q', answer: 'a', ai_agent_ids: [] })
    expect(() => parseFaq({ ai_agent_ids: ['nope'] }, true)).toThrow(InputError)
  })

  it('staff: days ordered, json blobs keep known keys only', () => {
    const row = parseStaff(
      {
        name: 'Ana',
        available_days: ['Friday', 'Monday', 'Funday'],
        weekly_slots: { Monday: [{ start_time: '09:00', end_time: '09:30', is_active: true, evil: 1 }], Tuesday: [], Bogus: [{}] },
        date_exceptions: [{ date: '2026-12-24', is_available: false, reason: 'Xmas', slots: [{ start_time: '10:00' }] }],
      },
      false,
    )
    expect(row.available_days).toEqual(['Monday', 'Friday'])
    expect(row.weekly_slots).toEqual({ Monday: [{ start_time: '09:00', end_time: '09:30', is_active: true }] })
    expect(row.date_exceptions).toEqual([{ date: '2026-12-24', is_available: false, reason: 'Xmas', slots: [{ start_time: '10:00' }] }])
    expect(() => parseStaff({ weekly_slots: { Monday: [{ start_time: 'late' }] } }, true)).toThrow(InputError)
    expect(() => parseStaff({ member_user_id: 'abc' }, true)).toThrow(InputError)
  })

  it('hours: one row per known day', () => {
    const row = { day_name: 'Monday', opening_time: '09:00', closing_time: '18:00:00', is_closed: false, break_start: '', break_end: null }
    expect(parseHours([row])).toEqual([{ ...row, closing_time: '18:00', break_start: null }])
    expect(() => parseHours([row, row])).toThrow(/Duplicated/)
    expect(() => parseHours([{ ...row, day_name: 'Lunes' }])).toThrow(InputError)
  })

  it('workspace patch validates industry, locale, timezone and special dates', () => {
    expect(parseWorkspacePatch({ name: 'X', slug: 'hack', settings: {}, timezone: '' })).toEqual({ name: 'X', timezone: 'UTC' })
    expect(() => parseWorkspacePatch({ industry: 'nope' })).toThrow(InputError)
    expect(() => parseWorkspacePatch({ locale: 'fr' })).toThrow(InputError)
    expect(() => parseWorkspacePatch({ timezone: 'Mars/Base' })).toThrow(InputError)
    expect(parseWorkspacePatch({ date_exceptions: [{ date: '2026-01-01', is_closed: true, opening_time: null, closing_time: null, reason: null }] })).toEqual({
      date_exceptions: [{ date: '2026-01-01', is_closed: true, opening_time: null, closing_time: null, reason: null }],
    })
  })

  it('settings merge keeps other keys and merges orders one level deeper', () => {
    const current = { modules: { a: true }, orders: { fulfillment: ['pickup'], extra: 1 }, other: 'x' }
    expect(mergeSettings(current, { orders: { delivery_fee: 5 }, booking_capacity: 3 })).toEqual({
      modules: { a: true },
      orders: { fulfillment: ['pickup'], extra: 1, delivery_fee: 5 },
      other: 'x',
      booking_capacity: 3,
    })
    expect(() => mergeSettings(current, { billing: {} })).toThrow(/cannot be changed/)
    expect(() => mergeSettings(current, { booking_capacity: 0 })).toThrow(InputError)
  })

  it('payment methods and bookings', () => {
    expect(() => parsePaymentMethod({ name: 'Nequi', type: 'crypto' }, false)).toThrow(InputError)
    expect(parsePaymentMethod({ name: 'x'.repeat(80), sort_order: 9 }, false)).toEqual({ name: 'x'.repeat(60) })
    expect(() => parseBooking({ booking_date: '2026-01-01', booking_time: '10:00' }, false)).toThrow(/contact_id/)
    expect(parseBooking({ status: 'cancelled', source: 'ai' }, true)).toEqual({ status: 'cancelled' })
    expect(() => parseBooking({ status: 'lost' }, true)).toThrow(InputError)
    expect(parseBooking({ party_size: '', custom_fields: null, booking_time: '09:30:00' }, true)).toEqual({ party_size: null, custom_fields: {}, booking_time: '09:30' })
  })
})

import { describe, expect, it } from 'vitest'
import { decideReminder, hoursUntilBooking, selectDueReminders, zonedTimeToUtc, type ReminderCandidate } from './reminders'

const none = { reminder_24h_sent: false, reminder_4h_sent: false, reminder_2h_sent: false }

describe('decideReminder (cascade)', () => {
  it('sends the 2h reminder and marks every flag when <= 2.5h away', () => {
    expect(decideReminder(2, none)).toEqual({
      kind: '2h',
      updates: { reminder_24h_sent: true, reminder_4h_sent: true, reminder_2h_sent: true },
    })
  })

  it('sends the 4h reminder between 2.5h and 5h', () => {
    expect(decideReminder(4.2, none)).toEqual({ kind: '4h', updates: { reminder_24h_sent: true, reminder_4h_sent: true } })
  })

  it('sends the 24h reminder between 5h and 24h', () => {
    expect(decideReminder(12, none)).toEqual({ kind: '24h', updates: { reminder_24h_sent: true } })
  })

  it('sends nothing when already sent, too far away or in the past', () => {
    expect(decideReminder(2, { reminder_24h_sent: true, reminder_4h_sent: true, reminder_2h_sent: true }).kind).toBeNull()
    expect(decideReminder(30, none).kind).toBeNull()
    expect(decideReminder(-1, none).kind).toBeNull()
    expect(decideReminder(0, none).kind).toBeNull()
  })

  it('skips to the 4h reminder when the 24h one was already sent', () => {
    expect(decideReminder(3, { ...none, reminder_24h_sent: true }).kind).toBe('4h')
    expect(decideReminder(10, { ...none, reminder_24h_sent: true }).kind).toBeNull()
  })
})

describe('time zones', () => {
  it('converts local wall time to UTC', () => {
    // Mexico City is UTC-6 all year (no DST since 2022).
    expect(zonedTimeToUtc('2026-10-06', '11:00', 'America/Mexico_City').toISOString()).toBe('2026-10-06T17:00:00.000Z')
    expect(zonedTimeToUtc('2026-10-06', '11:00', 'Asia/Kolkata').toISOString()).toBe('2026-10-06T05:30:00.000Z')
    // Madrid: CEST (+2) in July, CET (+1) in December.
    expect(zonedTimeToUtc('2026-07-01', '09:00', 'Europe/Madrid').toISOString()).toBe('2026-07-01T07:00:00.000Z')
    expect(zonedTimeToUtc('2026-12-01', '09:00', 'Europe/Madrid').toISOString()).toBe('2026-12-01T08:00:00.000Z')
    expect(zonedTimeToUtc('2026-10-06', '11:00', 'UTC').toISOString()).toBe('2026-10-06T11:00:00.000Z')
  })

  it('handles the DST gap / overlap without throwing', () => {
    // New York springs forward 2026-03-08 02:00 → 03:00.
    expect(zonedTimeToUtc('2026-03-08', '01:30', 'America/New_York').toISOString()).toBe('2026-03-08T06:30:00.000Z')
    expect(zonedTimeToUtc('2026-03-08', '03:30', 'America/New_York').toISOString()).toBe('2026-03-08T07:30:00.000Z')
  })

  it('computes hours until the booking in the business zone, not the server one', () => {
    const now = new Date('2026-10-06T15:00:00Z')
    expect(hoursUntilBooking('2026-10-06', '11:00', 'America/Mexico_City', now)).toBe(2)
    // Same wall clock in UTC would already be in the past.
    expect(hoursUntilBooking('2026-10-06', '11:00', 'UTC', now)).toBe(-4)
  })
})

describe('selectDueReminders', () => {
  const now = new Date('2026-10-06T15:00:00Z') // 09:00 in Mexico City
  const row = (id: string, date: string, time: string, extra: Partial<ReminderCandidate> = {}): ReminderCandidate => ({
    id,
    booking_date: date,
    booking_time: time,
    status: 'confirmed',
    timeZone: 'America/Mexico_City',
    ...none,
    ...extra,
  })

  it('picks the right bookings for a non-UTC workspace', () => {
    const due = selectDueReminders(
      [
        row('in-2h', '2026-10-06', '11:00'), // 2h → 2h reminder
        row('in-4h', '2026-10-06', '13:00'), // 4h → 4h reminder
        row('tomorrow-morning', '2026-10-07', '08:00'), // 23h → 24h reminder
        row('in-2-days', '2026-10-08', '10:00'), // 49h → nothing yet
        row('past', '2026-10-06', '08:30'), // already started
        row('cancelled', '2026-10-06', '11:00', { status: 'cancelled' }),
        row('already-reminded', '2026-10-06', '11:00', { reminder_24h_sent: true, reminder_4h_sent: true, reminder_2h_sent: true }),
        row('pending', '2026-10-06', '12:00', { status: 'pending' }), // 3h → 4h reminder
      ],
      now,
    )
    expect(due.map((d) => [d.booking.id, d.kind])).toEqual([
      ['in-2h', '2h'],
      ['in-4h', '4h'],
      ['tomorrow-morning', '24h'],
      ['pending', '4h'],
    ])
  })

  it('judges each booking in its own workspace zone', () => {
    const due = selectDueReminders(
      [
        row('mx', '2026-10-06', '11:00'), // 17:00Z → 2h away
        row('utc', '2026-10-06', '11:00', { timeZone: 'UTC' }), // 11:00Z → past
        row('madrid', '2026-10-06', '19:00', { timeZone: 'Europe/Madrid' }), // 17:00Z → 2h away
        row('bad-zone', '2026-10-06', '16:30', { timeZone: 'Not/AZone' }), // falls back to UTC → 1.5h
      ],
      now,
    )
    expect(due.map((d) => d.booking.id)).toEqual(['mx', 'madrid', 'bad-zone'])
  })
})

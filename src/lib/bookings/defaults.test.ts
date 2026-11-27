import { describe, expect, it } from 'vitest'
import { bookingDefaults } from './defaults'

describe('booking defaults', () => {
  it('is 30 minutes every 30 minutes when not set or invalid', () => {
    expect(bookingDefaults(null)).toEqual({ duration: 30, step: 30 })
    expect(bookingDefaults({ booking_default_duration: 7, booking_step: 20 })).toEqual({ duration: 30, step: 30 })
  })
  it('uses the business settings', () => {
    expect(bookingDefaults({ booking_default_duration: 45, booking_step: 15 })).toEqual({ duration: 45, step: 15 })
  })
})

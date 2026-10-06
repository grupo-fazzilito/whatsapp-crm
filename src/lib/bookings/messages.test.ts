import { describe, expect, it } from 'vitest'
import { buildBookingMessage, formatBookingDate, formatBookingTime } from './messages'

const base = { businessName: 'Barbería Don Pepe', date: '2026-10-09', time: '15:30' }

describe('buildBookingMessage', () => {
  it('uses the industry noun, Spanish by default wording and no clinic terms', () => {
    const msg = buildBookingMessage('confirmation', { ...base, locale: 'es', industry: 'barbershop', customerName: 'Luis', staffName: 'Toño' })
    expect(msg).toContain('¡Hola Luis!')
    expect(msg).toContain('tu turno con Toño')
    expect(msg).toContain('viernes, 9 de octubre')
    expect(msg).toContain('15:30')
    expect(msg).not.toMatch(/Dr\.|clinic|patient|paciente|₹/i)
  })

  it('restaurant reservation includes party size; works without a name', () => {
    const msg = buildBookingMessage('confirmation', { ...base, locale: 'es', industry: 'restaurant', partySize: 4 })
    expect(msg).toContain('¡Hola!')
    expect(msg).toContain('tu reservación (4 personas)')
  })

  it('English and workspace label overrides', () => {
    const msg = buildBookingMessage('reminder_2h', {
      ...base,
      locale: 'en',
      industry: 'academy',
      settings: { labels: { en: { booking: 'Lesson' } } },
    })
    expect(msg).toContain('Your lesson is at *3:30 PM*')
  })

  it('formats dates/times per locale', () => {
    expect(formatBookingDate('2026-10-09', 'en')).toBe('Friday, October 9')
    expect(formatBookingTime('09:05', 'es')).toBe('09:05')
  })
})

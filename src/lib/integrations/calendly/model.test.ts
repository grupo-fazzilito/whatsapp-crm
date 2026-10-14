import crypto from 'crypto'
import { describe, expect, it } from 'vitest'
import { bookingFromInvitee, inviteeLocation, prefilledLink, slotsByDate, utcInstant, uuidOf, verifyWebhookSignature } from './model'

describe('webhook signature', () => {
  const key = 'signing-key'
  const body = '{"event":"invitee.created"}'
  const now = 1_760_000_000_000
  const sign = (t: number, b = body) => `t=${t},v1=${crypto.createHmac('sha256', key).update(`${t}.${b}`).digest('hex')}`

  it('accepts a fresh signature over the raw body', () => {
    expect(verifyWebhookSignature(sign(now / 1000), body, key, now)).toBe(true)
  })
  it('rejects a changed body, another key, a stale timestamp or a malformed header', () => {
    expect(verifyWebhookSignature(sign(now / 1000), body + ' ', key, now)).toBe(false)
    expect(verifyWebhookSignature(sign(now / 1000), body, 'other', now)).toBe(false)
    expect(verifyWebhookSignature(sign(now / 1000 - 600), body, key, now)).toBe(false)
    expect(verifyWebhookSignature('v1=abc', body, key, now)).toBe(false)
    expect(verifyWebhookSignature(null, body, key, now)).toBe(false)
  })
})

describe('times', () => {
  it('converts workspace-local slots to UTC and back (Lima, UTC-5)', () => {
    expect(utcInstant('2026-10-20', '09:30', 'America/Lima')).toBe('2026-10-20T14:30:00Z')
    expect(slotsByDate([
      { status: 'available', start_time: '2026-10-20T14:30:00Z' },
      { status: 'available', start_time: '2026-10-20T13:00:00.000000Z' },
      { status: 'unavailable', start_time: '2026-10-20T15:00:00Z' },
      { status: 'available', start_time: '2026-10-21T04:30:00Z' },
    ], 'America/Lima')).toEqual({ '2026-10-20': ['08:00', '09:30', '23:30'] })
  })
})

describe('helpers', () => {
  it('prefills name and email on the booking link', () => {
    expect(prefilledLink('https://calendly.com/acme/30min/2026-10-20T14:30:00Z?month=2026-10', { name: 'Ana Pérez', email: 'ana@x.pe' }))
      .toBe('https://calendly.com/acme/30min/2026-10-20T14:30:00Z?month=2026-10&name=Ana+P%C3%A9rez&email=ana%40x.pe')
  })

  it('picks the location for API bookings', () => {
    expect(inviteeLocation([], null)).toBeUndefined()
    expect(inviteeLocation(['google_conference'], null)).toEqual({ kind: 'google_conference' })
    expect(inviteeLocation(['outbound_call'], '+51999888777')).toEqual({ kind: 'outbound_call', location: '+51999888777' })
    expect(inviteeLocation(['outbound_call'], null)).toBeNull()
    expect(inviteeLocation(['ask_invitee'], '+51999')).toBeNull()
  })

  it('maps an invitee to booking fields', () => {
    const f = bookingFromInvitee(
      { uri: 'https://api.calendly.com/scheduled_events/E1/invitees/I1', email: 'a@b.pe', name: 'Ana', status: 'active', cancel_url: 'c', reschedule_url: 'r', questions_and_answers: [{ question: 'Motivo', answer: 'Control' }] },
      { uri: 'https://api.calendly.com/scheduled_events/E1', start_time: '2026-10-20T14:30:00Z', end_time: '2026-10-20T15:15:00Z', event_type: 'et' },
      'America/Lima',
    )
    expect(f).toMatchObject({ booking_date: '2026-10-20', booking_time: '09:30', duration_minutes: 45, status: 'confirmed', notes: 'Motivo: Control', calendly_cancel_url: 'c' })
    expect(uuidOf('https://api.calendly.com/scheduled_events/E1/')).toBe('E1')
  })
})

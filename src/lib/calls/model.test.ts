import { describe, expect, it } from 'vitest'
import { callingSettingsBody, finalStatus, formatDuration, parseCallWebhook, readCallingState, tierAllowsCalling, weeklyHours } from './model'

const hook = (calls: object[], contacts?: object[]) => ({
  object: 'whatsapp_business_account',
  entry: [{ changes: [{ field: 'calls', value: { metadata: { phone_number_id: 'PN1' }, contacts, calls } }] }],
})

describe('parseCallWebhook', () => {
  it('reads an incoming call with its WebRTC offer', () => {
    const [ev] = parseCallWebhook(
      hook(
        [{ id: 'wacid.A', from: '51987654321', to: '5112345', event: 'connect', direction: 'USER_INITIATED', timestamp: '1671644824', session: { sdp_type: 'offer', sdp: 'v=0...' } }],
        [{ profile: { name: 'Ana' }, wa_id: '51987654321' }],
      ),
    )
    expect(ev).toEqual({ kind: 'connect', phoneNumberId: 'PN1', callId: 'wacid.A', phone: '51987654321', userId: null, name: 'Ana', sdp: 'v=0...', timestamp: 1671644824000 })
  })

  it('reads answered and unanswered terminates', () => {
    const events = parseCallWebhook(
      hook([
        { id: 'wacid.A', event: 'terminate', direction: 'USER_INITIATED', timestamp: '2', status: 'COMPLETED', start_time: '1', end_time: '121', duration: 120 },
        { id: 'wacid.B', event: 'terminate', direction: 'USER_INITIATED', timestamp: '3', status: 'COMPLETED' },
      ]),
    )
    expect(events).toMatchObject([
      { kind: 'terminate', callId: 'wacid.A', answered: true, durationSeconds: 120 },
      { kind: 'terminate', callId: 'wacid.B', answered: false, durationSeconds: null },
    ])
  })

  it('ignores business-initiated calls, other fields and other objects', () => {
    expect(parseCallWebhook(hook([{ id: 'x', from: '1', event: 'connect', direction: 'BUSINESS_INITIATED', session: { sdp: 'v' } }]))).toEqual([])
    expect(parseCallWebhook({ object: 'page', entry: [] })).toEqual([])
  })

  it('takes a caller known only by BSUID', () => {
    const [ev] = parseCallWebhook(hook([{ id: 'c', from_user_id: 'PE.77', event: 'connect', session: { sdp: 'v' } }]))
    expect(ev).toMatchObject({ phone: null, userId: 'PE.77' })
  })
})

describe('call outcome', () => {
  const term = (answered: boolean, status = 'COMPLETED', error: string | null = null) =>
    ({ kind: 'terminate', phoneNumberId: 'P', callId: 'c', status, durationSeconds: answered ? 30 : null, answered, error, timestamp: 0 }) as const
  it('maps how the call ended', () => {
    expect(finalStatus('in_progress', term(true))).toBe('completed')
    expect(finalStatus('ringing', term(false))).toBe('missed')
    expect(finalStatus('rejected', term(false))).toBe('rejected')
    expect(finalStatus('answering', term(false, 'FAILED', 'ICE failed'))).toBe('failed')
  })
  it('formats durations', () => {
    expect(formatDuration(125)).toBe('2:05')
    expect(formatDuration(null)).toBe('0:00')
  })
})

describe('call settings', () => {
  const rows = [
    { day_name: 'Monday', opening_time: '09:00', closing_time: '18:00', is_closed: false, break_start: '13:00', break_end: '14:00' },
    { day_name: 'Saturday', opening_time: '9:30', closing_time: '13:00', is_closed: false, break_start: null, break_end: null },
    { day_name: 'Sunday', opening_time: null, closing_time: null, is_closed: true, break_start: null, break_end: null },
  ]
  it('turns business hours into Meta call hours, splitting the lunch break', () => {
    expect(weeklyHours(rows)).toEqual([
      { day_of_week: 'MONDAY', open_time: '0900', close_time: '1300' },
      { day_of_week: 'MONDAY', open_time: '1400', close_time: '1800' },
      { day_of_week: 'SATURDAY', open_time: '0930', close_time: '1300' },
    ])
  })
  it('builds the settings body', () => {
    expect(callingSettingsBody({ enabled: true })).toEqual({
      calling: { status: 'ENABLED', call_icon_visibility: 'DEFAULT', callback_permission_status: 'DISABLED', call_hours: { status: 'DISABLED' } },
    })
    expect(callingSettingsBody({ enabled: true, hours: { timezone: 'America/Lima', rows } }).calling.call_hours).toMatchObject({
      status: 'ENABLED',
      timezone_id: 'America/Lima',
    })
    expect(callingSettingsBody({ enabled: false }).calling.status).toBe('DISABLED')
  })
  it('knows which messaging tiers allow calling', () => {
    expect(tierAllowsCalling('TIER_250')).toBe(false)
    expect(tierAllowsCalling('TIER_2K')).toBe(true)
    expect(tierAllowsCalling('TIER_UNLIMITED')).toBe(true)
    expect(tierAllowsCalling(null)).toBeNull()
  })
  it('reads the stored state', () => {
    expect(readCallingState({ calling: { enabled: true, tier: 'TIER_2K' } })).toMatchObject({ enabled: true, tier: 'TIER_2K', use_business_hours: false })
    expect(readCallingState({})).toBeNull()
  })
})

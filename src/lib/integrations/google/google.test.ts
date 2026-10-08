import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import {
  addMinutesLocal,
  buildEventPayload,
  buildEventSummary,
  busyToLocal,
  eventIdFor,
  eventLocal,
  mapInboundEvent,
  zonedWallToUtc,
  type SyncedBooking,
} from './event'
import { signState, stateSecret, verifyState, STATE_TTL_MS } from './state'
import { checkNotification, readNotificationHeaders } from './webhook'
import { googleEndpoints, pushSupported, redirectUri, webhookUrl } from './endpoints'
import { buildGoogleConfig } from './config'
import { encrypt } from '@/lib/whatsapp/encryption'
import { cancelledText, rescheduledText } from './texts'

const BOOKING_ID = '3f0c9a52-8d1e-4b7a-9c2d-1e2f3a4b5c6d'
const WS_ID = '11111111-2222-3333-4444-555555555555'

describe('event payload', () => {
  const base = {
    bookingId: BOOKING_ID,
    workspaceId: WS_ID,
    date: '2026-10-10',
    time: '15:00',
    durationMinutes: 60,
    timeZone: 'America/Lima',
    status: 'confirmed',
    locale: 'es' as const,
    bookingLabel: 'Visita',
    title: 'Depto 3 dorm. en Miraflores',
    customerName: 'Ana Torres',
    customerPhone: '+51987654321',
    notes: 'Viene con su pareja',
    location: 'Av. Larco 123, Miraflores, Lima',
    conversationUrl: 'https://crm.example.com/inbox?c=abc',
  }

  it('writes wall-clock times in the workspace time zone', () => {
    const p = buildEventPayload(base)
    expect(p.start).toEqual({ dateTime: '2026-10-10T15:00:00', timeZone: 'America/Lima' })
    expect(p.end).toEqual({ dateTime: '2026-10-10T16:00:00', timeZone: 'America/Lima' })
  })

  it('builds summary, location, description and private properties', () => {
    const p = buildEventPayload(base) as Record<string, unknown>
    expect(p.summary).toBe('Visita: Depto 3 dorm. en Miraflores — Ana Torres')
    expect(p.location).toBe('Av. Larco 123, Miraflores, Lima')
    expect(p.description).toContain('Teléfono: +51987654321')
    expect(p.description).toContain('Notas: Viene con su pareja')
    expect(p.description).toContain('https://crm.example.com/inbox?c=abc')
    expect(p.extendedProperties).toEqual({ private: { booking_id: BOOKING_ID, workspace_id: WS_ID } })
    expect(p.status).toBe('confirmed')
    expect(p.conferenceData).toBeUndefined()
  })

  it('rolls the end over midnight and maps pending to tentative', () => {
    const p = buildEventPayload({ ...base, time: '23:30', durationMinutes: 90, status: 'pending' }) as Record<string, unknown>
    expect(p.end).toEqual({ dateTime: '2026-10-11T01:00:00', timeZone: 'America/Lima' })
    expect(p.status).toBe('tentative')
  })

  it('pads short times and adds a Meet request when asked', () => {
    const p = buildEventPayload({ ...base, time: '9:05', addMeet: true, meetRequestId: 'r1' }) as Record<string, unknown>
    expect((p.start as { dateTime: string }).dateTime).toBe('2026-10-10T09:05:00')
    expect(p.conferenceData).toEqual({ createRequest: { requestId: 'r1', conferenceSolutionKey: { type: 'hangoutsMeet' } } })
  })

  it('summary degrades gracefully', () => {
    expect(buildEventSummary('Cita')).toBe('Cita')
    expect(buildEventSummary('Cita', null, 'Luis')).toBe('Cita — Luis')
    expect(buildEventSummary('Cita', 'Corte')).toBe('Cita: Corte')
  })

  it('event ids are deterministic base32hex', () => {
    const id = eventIdFor(BOOKING_ID)
    expect(id).toBe('bk3f0c9a528d1e4b7a9c2d1e2f3a4b5c6d')
    expect(id).toMatch(/^[0-9a-v]{5,1024}$/)
  })

  it('addMinutesLocal', () => {
    expect(addMinutesLocal('2026-12-31', '23:00', 120)).toEqual({ date: '2027-01-01', time: '01:00' })
  })
})

describe('time zones', () => {
  it('converts Lima wall clock to UTC (UTC-5, no DST)', () => {
    expect(zonedWallToUtc('2026-10-10', '15:00', 'America/Lima').toISOString()).toBe('2026-10-10T20:00:00.000Z')
  })
  it('handles DST zones', () => {
    // Madrid: CEST (UTC+2) in July, CET (UTC+1) in December.
    expect(zonedWallToUtc('2026-07-01', '10:00', 'Europe/Madrid').toISOString()).toBe('2026-07-01T08:00:00.000Z')
    expect(zonedWallToUtc('2026-12-01', '10:00', 'Europe/Madrid').toISOString()).toBe('2026-12-01T09:00:00.000Z')
  })
  it('reads event times with offsets, Z, or a separate timeZone', () => {
    expect(eventLocal({ dateTime: '2026-10-10T15:00:00-05:00' }, 'America/Lima')).toMatchObject({ date: '2026-10-10', time: '15:00' })
    expect(eventLocal({ dateTime: '2026-10-11T02:30:00Z' }, 'America/Lima')).toMatchObject({ date: '2026-10-10', time: '21:30' })
    expect(eventLocal({ dateTime: '2026-10-10T10:00:00', timeZone: 'America/Mexico_City' }, 'America/Lima')).toMatchObject({ date: '2026-10-10', time: '11:00' })
    expect(eventLocal({ date: '2026-10-10' }, 'America/Lima')).toBeNull()
  })
  it('splits busy intervals per local day', () => {
    expect(
      busyToLocal(
        [
          { start: '2026-10-10T14:00:00Z', end: '2026-10-10T15:30:00Z' },
          // 22:00 Lima on the 10th → 08:00 Lima on the 12th
          { start: '2026-10-11T03:00:00Z', end: '2026-10-12T13:00:00Z' },
          { start: 'bad', end: '2026-10-12T13:00:00Z' },
        ],
        'America/Lima',
      ),
    ).toEqual([
      { date: '2026-10-10', start: '09:00', end: '10:30' },
      { date: '2026-10-10', start: '22:00', end: '24:00' },
      { date: '2026-10-11', start: '00:00', end: '24:00' },
      { date: '2026-10-12', start: '00:00', end: '08:00' },
    ])
  })
})

describe('inbound mapping', () => {
  const booking: SyncedBooking = { id: BOOKING_ID, booking_date: '2026-10-10', booking_time: '15:00', duration_minutes: 60, status: 'confirmed' }
  const ev = (start: string, end: string, extra = {}) => ({ id: 'e', start: { dateTime: start }, end: { dateTime: end }, ...extra })

  it('no change when the event matches (our own echo)', () => {
    expect(mapInboundEvent(ev('2026-10-10T15:00:00-05:00', '2026-10-10T16:00:00-05:00'), booking, 'America/Lima')).toEqual({ kind: 'none' })
  })
  it('moved', () => {
    expect(mapInboundEvent(ev('2026-10-11T16:30:00-05:00', '2026-10-11T17:30:00-05:00'), booking, 'America/Lima')).toEqual({
      kind: 'moved',
      date: '2026-10-11',
      time: '16:30',
      durationMinutes: 60,
    })
  })
  it('resized only', () => {
    expect(mapInboundEvent(ev('2026-10-10T20:00:00Z', '2026-10-10T21:30:00Z'), booking, 'America/Lima')).toEqual({
      kind: 'moved',
      date: '2026-10-10',
      time: '15:00',
      durationMinutes: 90,
    })
  })
  it('cancelled / deleted', () => {
    expect(mapInboundEvent({ id: 'e', status: 'cancelled' }, booking, 'America/Lima')).toEqual({ kind: 'cancelled' })
  })
  it('ignores bookings that are no longer active and all-day moves', () => {
    expect(mapInboundEvent({ id: 'e', status: 'cancelled' }, { ...booking, status: 'cancelled' }, 'America/Lima')).toEqual({ kind: 'none' })
    expect(mapInboundEvent({ id: 'e', start: { date: '2026-10-11' }, end: { date: '2026-10-12' } }, booking, 'America/Lima')).toEqual({ kind: 'none' })
  })
})

describe('OAuth state', () => {
  const secret = stateSecret('a'.repeat(64))
  it('round-trips and carries the flow', () => {
    const raw = signState({ w: WS_ID, s: 'staff', u: 'user', r: 'profile' }, secret, 1000)
    const res = verifyState(raw, secret, 2000)
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.state).toMatchObject({ w: WS_ID, s: 'staff', u: 'user', r: 'profile', e: 1000 + STATE_TTL_MS })
  })
  it('rejects tampering, other keys, expiry and junk', () => {
    const raw = signState({ w: WS_ID, s: 'staff', u: 'user' }, secret, 1000)
    const [payload, sig] = raw.split('.')
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), s: 'other' })).toString('base64url')
    expect(verifyState(`${forged}.${sig}`, secret, 2000)).toEqual({ ok: false, reason: 'signature' })
    expect(verifyState(raw, stateSecret('b'.repeat(64)), 2000)).toEqual({ ok: false, reason: 'signature' })
    expect(verifyState(raw, secret, 1000 + STATE_TTL_MS + 1)).toEqual({ ok: false, reason: 'expired' })
    expect(verifyState('nope', secret)).toEqual({ ok: false, reason: 'malformed' })
    expect(verifyState(null, secret)).toEqual({ ok: false, reason: 'malformed' })
    expect(verifyState(`${raw}.x`, secret)).toEqual({ ok: false, reason: 'malformed' })
  })
  it('nonces differ between flows', () => {
    expect(signState({ w: 'a', s: 'b', u: 'c' }, secret)).not.toBe(signState({ w: 'a', s: 'b', u: 'c' }, secret))
  })
})

describe('webhook validation', () => {
  const stored = { watch_channel_id: 'chan-1', watch_resource_id: 'res-1', watch_token: 'tok-secret' }
  const headers = (over: Record<string, string> = {}) =>
    readNotificationHeaders(
      new Headers({
        'X-Goog-Channel-ID': 'chan-1',
        'X-Goog-Channel-Token': 'tok-secret',
        'X-Goog-Resource-ID': 'res-1',
        'X-Goog-Resource-State': 'exists',
        'X-Goog-Message-Number': '2',
        ...over,
      }),
    )
  it('accepts a valid change notification', () => {
    expect(checkNotification(headers(), stored)).toEqual({ ok: true, action: 'sync' })
  })
  it('acknowledges the initial sync message without work', () => {
    expect(checkNotification(headers({ 'X-Goog-Resource-State': 'sync' }), stored)).toEqual({ ok: true, action: 'ignore' })
  })
  it('rejects unknown channels, bad tokens and foreign resources', () => {
    expect(checkNotification(headers(), null)).toEqual({ ok: false, status: 404 })
    expect(checkNotification(headers({ 'X-Goog-Channel-ID': 'chan-2' }), stored)).toEqual({ ok: false, status: 404 })
    expect(checkNotification(headers({ 'X-Goog-Channel-Token': 'tok-secreT' }), stored)).toEqual({ ok: false, status: 403 })
    expect(checkNotification(headers({ 'X-Goog-Resource-ID': 'res-2' }), stored)).toEqual({ ok: false, status: 403 })
    expect(checkNotification(headers(), { ...stored, watch_token: null })).toEqual({ ok: false, status: 403 })
    const missing = readNotificationHeaders(new Headers({ 'X-Goog-Channel-ID': 'chan-1' }))
    expect(checkNotification(missing, stored)).toEqual({ ok: false, status: 400 })
  })
})

describe('endpoints and config', () => {
  it('uses the mock only outside production', () => {
    expect(googleEndpoints({ GOOGLE_API_MOCK_URL: 'http://localhost:4555/', NODE_ENV: 'development' }).token).toBe('http://localhost:4555/token')
    expect(googleEndpoints({ GOOGLE_API_MOCK_URL: 'http://localhost:4555', NODE_ENV: 'production' }).token).toBe('https://oauth2.googleapis.com/token')
    expect(googleEndpoints({}).calendar).toBe('https://www.googleapis.com/calendar/v3')
  })
  it('derives redirect and webhook URLs; push needs https', () => {
    const env = { NEXT_PUBLIC_SITE_URL: 'https://crm.example.com/' }
    expect(redirectUri(env)).toBe('https://crm.example.com/api/integrations/google/callback')
    expect(webhookUrl(env)).toBe('https://crm.example.com/api/integrations/google/webhook')
    expect(pushSupported(env)).toBe(true)
    expect(pushSupported({ NEXT_PUBLIC_SITE_URL: 'http://localhost:3001' })).toBe(false)
  })
  it('panel credentials win over env; env is the fallback', () => {
    const env = { GOOGLE_CLIENT_ID: 'env-id', GOOGLE_CLIENT_SECRET: 'env-secret' }
    expect(buildGoogleConfig({ client_id: 'panel-id', client_secret: encrypt('panel-secret') }, env)).toEqual({
      clientId: 'panel-id',
      clientSecret: 'panel-secret',
      source: 'panel',
    })
    expect(buildGoogleConfig({ client_id: 'panel-id' }, env)?.source).toBe('env')
    expect(buildGoogleConfig(null, {})).toBeNull()
  })
})

describe('customer texts', () => {
  it('es and en', () => {
    expect(rescheduledText({ locale: 'es', booking: 'visita', customerName: 'Ana Torres', date: '2026-10-11', time: '16:30' })).toBe(
      'Hola Ana, tu visita se reprogramó para el domingo, 11 de octubre a las 16:30. Si no te acomoda, respóndenos y buscamos otro horario.',
    )
    expect(cancelledText({ locale: 'en', booking: 'viewing', date: '2026-10-11', time: '16:30' })).toContain('your viewing on Sunday, October 11 at 4:30 PM has been cancelled')
  })
})

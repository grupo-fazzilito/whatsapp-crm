import { afterEach, describe, expect, it, vi } from 'vitest'
import { whatsappAdapter } from './adapters/whatsapp'
import { messengerAdapter } from './adapters/meta-messaging'
import { locationText, mapsLink, type LoadedChannel } from './types'

const channel = (type: LoadedChannel['type']): LoadedChannel =>
  ({ id: 'ch', workspace_id: 'ws', type, external_id: 'PNID', settings: {}, secrets: { access_token: 'tok' } }) as unknown as LoadedChannel

const pin = { type: 'location' as const, latitude: -12.1211, longitude: -77.0297, name: 'Depa Miraflores', address: 'Av. Larco 123' }

afterEach(() => vi.unstubAllGlobals())

describe('location messages', () => {
  it('WhatsApp sends a native location message', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ messages: [{ id: 'wamid.1' }] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const res = await whatsappAdapter.send({ channel: channel('whatsapp'), recipient: '51999888777' }, pin)
    expect(res.externalId).toBe('wamid.1')
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body)
    expect(body).toMatchObject({ type: 'location', location: { latitude: -12.1211, longitude: -77.0297, name: 'Depa Miraflores', address: 'Av. Larco 123' } })
  })

  it('Messenger / Instagram fall back to text with a Google Maps link', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ message_id: 'mid.1' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await messengerAdapter.send({ channel: channel('messenger'), recipient: 'PSID' }, pin)
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body)
    expect(body.message.text).toContain('https://www.google.com/maps/search/?api=1&query=-12.1211%2C-77.0297')
    expect(body.message.text).toContain('Depa Miraflores — Av. Larco 123')
  })

  it('text fallback helpers', () => {
    expect(mapsLink(1.5, 2)).toBe('https://www.google.com/maps/search/?api=1&query=1.5%2C2')
    expect(locationText({ type: 'location', latitude: 1, longitude: 2 })).toContain('📍')
  })
})

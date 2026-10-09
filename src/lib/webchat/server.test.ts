import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
// Pure helpers only: no database client needed.
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/db/tenant', () => ({ tenantDb: () => ({}) }))

import { originAllowed, publicMessage, signVisitorToken, verifyVisitorToken } from './server'
import type { ChannelRow } from '@/lib/channels'

const channel = (allowed: string[]) => ({ settings: { allowed_origins: allowed } }) as unknown as ChannelRow

describe('visitor tokens', () => {
  it('round-trips and rejects tampering', () => {
    const token = signVisitorToken('chan-1', 'visitor-1')
    expect(verifyVisitorToken(token)).toMatchObject({ c: 'chan-1', v: 'visitor-1' })

    const [, mac] = token.split('.')
    const forged = Buffer.from(JSON.stringify({ c: 'chan-2', v: 'visitor-1', iat: Math.floor(Date.now() / 1000) })).toString('base64url')
    expect(verifyVisitorToken(`${forged}.${mac}`)).toBeNull()
    expect(verifyVisitorToken(token.slice(0, -2) + 'xx')).toBeNull()
    expect(verifyVisitorToken('garbage')).toBeNull()
    expect(verifyVisitorToken(undefined)).toBeNull()
  })
})

describe('originAllowed', () => {
  it('allows any origin when the list is empty', () => {
    expect(originAllowed(channel([]), 'https://anything.test')).toBe(true)
  })
  it('matches exact origins and wildcard subdomains', () => {
    const ch = channel(['https://shop.com/', 'https://*.brand.io'])
    expect(originAllowed(ch, 'https://shop.com')).toBe(true)
    expect(originAllowed(ch, 'https://SHOP.com')).toBe(true)
    expect(originAllowed(ch, 'http://shop.com')).toBe(false)
    expect(originAllowed(ch, 'https://eu.brand.io')).toBe(true)
    expect(originAllowed(ch, 'https://brand.io.evil.com')).toBe(false)
    expect(originAllowed(ch, 'https://evilbrand.io')).toBe(false)
  })
})

describe('publicMessage', () => {
  it('keeps widget fields, cards trimmed, and drops internal ids', () => {
    const m = publicMessage({
      id: 'm1',
      sender_type: 'bot',
      content_type: 'interactive',
      content_text: 'Mira',
      media_url: null,
      created_at: '2026-01-01T00:00:00Z',
      metadata: {
        order_id: 'o1',
        cart_id: 'c1',
        event: 'cart_summary',
        error: 'x',
        options: [{ id: 'cart:view', title: 'Ver' }],
        cards: [
          { id: 'p1', imageUrl: 'https://cdn.test/a.jpg', title: 'Pizza', subtitle: 'S/ 30', buttons: [{ id: 'cart:add:p1', title: 'Agregar', extra: 1 }] },
          { id: 'p2', imageUrl: 'javascript:alert(1)', title: 'Bad', buttons: [] },
          { imageUrl: 'https://x', buttons: [] },
        ],
      },
    })
    expect(Object.keys(m.metadata).sort()).toEqual(['cards', 'options'])
    expect(m.metadata.cards).toEqual([
      { imageUrl: 'https://cdn.test/a.jpg', title: 'Pizza', subtitle: 'S/ 30', buttons: [{ id: 'cart:add:p1', title: 'Agregar' }] },
      { imageUrl: null, title: 'Bad', subtitle: undefined, buttons: [] },
    ])
  })
})

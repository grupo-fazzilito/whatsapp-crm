import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
// Pure helpers only: no database client needed.
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/db/tenant', () => ({ tenantDb: () => ({}) }))

import { candidateCookies, readCandidates, seal, sign, unseal, verifySigned } from './shared'
import { newWidgetKey, parseWebchatSettings, webchatHandle } from './webchat'

describe('signed state', () => {
  it('round-trips and rejects tampering', () => {
    const token = sign({ ws: 'w', uid: 'u', t: 1 })
    expect(verifySigned(token)).toEqual({ ws: 'w', uid: 'u', t: 1 })
    const [body, mac] = token.split('.')
    const forged = Buffer.from(JSON.stringify({ ws: 'other', uid: 'u', t: 1 })).toString('base64url')
    expect(verifySigned(`${forged}.${mac}`)).toBeNull()
    expect(verifySigned(`${body}.x${mac.slice(1)}`)).toBeNull()
    expect(verifySigned('garbage')).toBeNull()
  })
})

describe('sealed cookies', () => {
  it('round-trips and rejects tampering', () => {
    const s = seal({ a: 1 })
    expect(unseal(s)).toEqual({ a: 1 })
    expect(unseal(s.slice(0, -2) + 'AA')).toBeNull()
  })

  it('splits many pages across cookies and reads them back', () => {
    const pages = Array.from({ length: 12 }, (_, i) => ({
      id: `${1000 + i}`,
      name: `Page ${i}`,
      token: 'EAA' + 'x'.repeat(200),
      ig: i % 2 ? { id: `178${i}`, username: `user${i}` } : null,
    }))
    const data = { ws: 'w', uid: 'u', exp: Date.now() + 60_000, pages }
    const cookies = candidateCookies(data)
    expect(cookies.length).toBeGreaterThan(1)
    for (const c of cookies) expect(c.value.length).toBeLessThanOrEqual(3500)
    const jar = new Map(cookies.map((c) => [c.name, c.value]))
    expect(readCandidates((n) => jar.get(n))).toEqual(data)
  })

  it('treats expired candidates as missing', () => {
    const cookies = candidateCookies({ ws: 'w', uid: 'u', exp: Date.now() - 1, pages: [] })
    const jar = new Map(cookies.map((c) => [c.name, c.value]))
    expect(readCandidates((n) => jar.get(n))).toBeNull()
  })
})

describe('webchat settings', () => {
  it('normalizes origins and filters prechat fields', () => {
    const r = parseWebchatSettings({
      color: '#AABBCC',
      allowed_origins: ['minegocio.com', 'https://shop.example.com/path', 'minegocio.com'],
      prechat_fields: ['email', 'bogus', 'name'],
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.settings.color).toBe('#aabbcc')
    expect(r.settings.allowed_origins).toEqual(['https://minegocio.com', 'https://shop.example.com'])
    expect(r.settings.prechat_fields).toEqual(['name', 'email'])
    expect(webchatHandle(r.settings)).toBe('minegocio.com')
  })

  it('keeps base values on partial updates and rejects bad input', () => {
    const r = parseWebchatSettings({ position: 'left' }, { color: '#000000', title: 'Hola' })
    expect(r.ok && r.settings).toMatchObject({ color: '#000000', title: 'Hola', position: 'left' })
    expect(parseWebchatSettings({ color: 'red' }).ok).toBe(false)
    expect(parseWebchatSettings({ position: 'top' }).ok).toBe(false)
    expect(parseWebchatSettings({ allowed_origins: ['javascript:alert(1)'] }).ok).toBe(false)
  })

  it('makes pk_ keys with 24 url-safe chars', () => {
    expect(newWidgetKey()).toMatch(/^pk_[A-Za-z0-9_-]{24}$/)
  })
})

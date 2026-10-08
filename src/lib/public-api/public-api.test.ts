import { describe, expect, it } from 'vitest'
import { bearerToken, generateApiKey, hasScope, hashApiKey, keyMatchesHash, normalizeScopes, parseApiKey, API_KEY_PREFIX } from './keys'
import { cursorFilter, decodeCursor, encodeCursor, pageOf, parseIsoParam, parseLimit, MAX_LIMIT } from './pagination'
import { ApiError } from './errors'
import { oneOf, str, num, uuid } from './validate'

describe('API keys', () => {
  it('generates cnx_live_ keys with a stored hash and 8-char prefix', () => {
    const k = generateApiKey()
    expect(k.secret.startsWith(API_KEY_PREFIX)).toBe(true)
    expect(k.secret.length).toBeGreaterThanOrEqual(API_KEY_PREFIX.length + 40)
    expect(k.prefix).toBe(k.secret.slice(API_KEY_PREFIX.length, API_KEY_PREFIX.length + 8))
    expect(k.hash).toBe(hashApiKey(k.secret))
    expect(k.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(generateApiKey().secret).not.toBe(k.secret)
  })

  it('verifies in constant time against the hash', () => {
    const k = generateApiKey()
    expect(keyMatchesHash(k.secret, k.hash)).toBe(true)
    expect(keyMatchesHash(`${k.secret}x`, k.hash)).toBe(false)
    expect(keyMatchesHash(k.secret, 'abcd')).toBe(false)
    expect(keyMatchesHash(k.secret, '')).toBe(false)
  })

  it('parses bearer headers and key shape', () => {
    const k = generateApiKey()
    expect(bearerToken(`Bearer ${k.secret}`)).toBe(k.secret)
    expect(bearerToken(`bearer   ${k.secret} `)).toBe(k.secret)
    expect(bearerToken('Basic abc')).toBeNull()
    expect(bearerToken(null)).toBeNull()
    expect(parseApiKey(k.secret)).toEqual({ prefix: k.prefix })
    expect(parseApiKey('cnx_live_short')).toBeNull()
    expect(parseApiKey('sk_live_' + 'a'.repeat(43))).toBeNull()
  })
})

describe('scopes', () => {
  it('read covers every GET, write covers everything', () => {
    expect(hasScope(['read'], 'orders', 'read')).toBe(true)
    expect(hasScope(['read'], 'orders', 'write')).toBe(false)
    expect(hasScope(['write'], 'messages:send', 'write')).toBe(true)
    expect(hasScope(['write'], 'catalog', 'read')).toBe(true)
  })
  it('resource scopes are limited to their resource', () => {
    expect(hasScope(['orders'], 'orders', 'write')).toBe(true)
    expect(hasScope(['orders'], 'orders', 'read')).toBe(true)
    expect(hasScope(['orders'], 'contacts', 'read')).toBe(false)
    expect(hasScope(['conversations'], 'messages:send', 'write')).toBe(false)
    expect(hasScope(['messages:send'], 'messages:send', 'write')).toBe(true)
    expect(hasScope([], 'contacts', 'read')).toBe(false)
  })
  it('normalizes unknown scopes away', () => {
    expect(normalizeScopes(['orders', 'admin', 'read', 'orders'])).toEqual(['read', 'orders'])
    expect(normalizeScopes('read')).toEqual([])
  })
})

describe('cursor pagination', () => {
  const id = '3f2b7c1e-9a4d-4c2e-8f1a-0b6d5e4c3a21'
  it('round-trips cursors', () => {
    const c = { v: '2026-10-08T12:00:00.123456+00:00', id }
    expect(decodeCursor(encodeCursor(c))).toEqual(c)
    expect(decodeCursor(null)).toBeNull()
  })
  it('rejects tampered cursors', () => {
    expect(() => decodeCursor('nope')).toThrow('invalid_cursor')
    expect(() => decodeCursor(Buffer.from(JSON.stringify(['x', id])).toString('base64url'))).toThrow('invalid_cursor')
    expect(() => decodeCursor(Buffer.from(JSON.stringify(['2026-10-08T12:00:00Z', 'id),or(x'])).toString('base64url'))).toThrow('invalid_cursor')
  })
  it('builds a keyset filter and next cursor', () => {
    expect(cursorFilter('created_at', { v: '2026-10-08T12:00:00Z', id })).toBe(
      `created_at.lt."2026-10-08T12:00:00Z",and(created_at.eq."2026-10-08T12:00:00Z",id.lt.${id})`,
    )
    const rows = [1, 2, 3].map((n) => ({ id: `${id.slice(0, -1)}${n}`, created_at: `2026-10-0${n}T00:00:00Z` }))
    const page = pageOf(rows, 2, (r) => r.created_at)
    expect(page.data).toHaveLength(2)
    expect(decodeCursor(page.next_cursor)).toEqual({ v: rows[1].created_at, id: rows[1].id })
    expect(pageOf(rows, 3, (r) => r.created_at).next_cursor).toBeNull()
  })
  it('validates limit and dates', () => {
    expect(parseLimit(null)).toBe(25)
    expect(parseLimit('500')).toBe(MAX_LIMIT)
    expect(() => parseLimit('0')).toThrow('invalid_limit')
    expect(() => parseLimit('abc')).toThrow('invalid_limit')
    expect(parseIsoParam('2026-10-08T10:00:00-05:00')).toBe('2026-10-08T15:00:00.000Z')
    expect(() => parseIsoParam('yesterday')).toThrow('invalid_date')
  })
})

describe('body validation', () => {
  it('throws 400 ApiErrors naming the field', () => {
    try {
      str({}, 'name', { required: true })
      throw new Error('should throw')
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError)
      expect((e as ApiError).status).toBe(400)
      expect((e as ApiError).details).toEqual({ field: 'name' })
    }
    expect(num({ price: '12.5' }, 'price', { min: 0 })).toBe(12.5)
    expect(() => num({ price: -1 }, 'price', { min: 0 })).toThrow(ApiError)
    expect(uuid({ x: null }, 'x')).toBeNull()
    expect(() => uuid({ x: 'abc' }, 'x')).toThrow(ApiError)
    expect(oneOf({ s: 'paid' }, 's', ['paid'] as const)).toBe('paid')
    expect(() => oneOf({ s: 'x' }, 's', ['paid'] as const)).toThrow(ApiError)
  })
})

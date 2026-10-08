import { describe, expect, it } from 'vitest'
import { computeSignature, generateWebhookSecret, parseSignatureHeader, signatureHeader, verifySignature } from './signature'
import { AUTO_DISABLE_AFTER, MAX_ATTEMPTS, RETRY_SCHEDULE_MS, isSuccessStatus, retryDelayMs, shouldAutoDisable, truncateBody } from './backoff'
import { checkWebhookUrl, isLoopbackAddress, isPrivateAddress } from './ssrf'
import { normalizeEvents, WEBHOOK_EVENTS } from './events'
import { createHmac } from 'crypto'

describe('webhook signature', () => {
  const secret = generateWebhookSecret()
  const body = JSON.stringify({ id: 'evt_1', type: 'order.paid', data: { a: 1 } })

  it('signs t.body with HMAC-SHA256', () => {
    const header = signatureHeader(secret, body, 1_760_000_000)
    const expected = createHmac('sha256', secret).update(`1760000000.${body}`).digest('hex')
    expect(header).toBe(`t=1760000000,v1=${expected}`)
    expect(computeSignature(secret, 1_760_000_000, body)).toBe(expected)
    expect(parseSignatureHeader(header)).toEqual({ t: 1_760_000_000, v1: [expected] })
  })

  it('verifies within tolerance and rejects tampering / replays', () => {
    const now = 1_760_000_000
    const header = signatureHeader(secret, body, now)
    expect(verifySignature(secret, body, header, { now })).toBe(true)
    expect(verifySignature(secret, body + ' ', header, { now })).toBe(false)
    expect(verifySignature('whsec_other', body, header, { now })).toBe(false)
    expect(verifySignature(secret, body, header, { now: now + 301 })).toBe(false)
    expect(verifySignature(secret, body, 'garbage', { now })).toBe(false)
    expect(verifySignature(secret, body, null, { now })).toBe(false)
  })

  it('secrets are random whsec_ strings', () => {
    expect(secret).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/)
    expect(generateWebhookSecret()).not.toBe(secret)
  })
})

describe('retry backoff', () => {
  it('follows 1m, 5m, 30m, 2h, 6h, 24h then gives up', () => {
    const min = 60_000
    expect(RETRY_SCHEDULE_MS).toEqual([min, 5 * min, 30 * min, 120 * min, 360 * min, 1440 * min])
    expect(retryDelayMs(1)).toBe(min)
    expect(retryDelayMs(6)).toBe(1440 * min)
    expect(retryDelayMs(7)).toBeNull()
    expect(MAX_ATTEMPTS).toBe(7)
  })
  it('auto-disables after 20 consecutive failures', () => {
    expect(AUTO_DISABLE_AFTER).toBe(20)
    expect(shouldAutoDisable(19)).toBe(false)
    expect(shouldAutoDisable(20)).toBe(true)
  })
  it('treats only 2xx as delivered and truncates bodies', () => {
    expect(isSuccessStatus(200)).toBe(true)
    expect(isSuccessStatus(204)).toBe(true)
    expect(isSuccessStatus(301)).toBe(false)
    expect(isSuccessStatus(500)).toBe(false)
    expect(isSuccessStatus(null)).toBe(false)
    expect(truncateBody('x'.repeat(3000)).length).toBe(2049)
  })
})

describe('SSRF guard', () => {
  it('flags private, loopback, link-local and mapped addresses', () => {
    for (const ip of ['10.0.0.1', '127.0.0.1', '169.254.169.254', '172.16.5.4', '192.168.1.1', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.0.0.1', 'not-an-ip']) {
      expect(isPrivateAddress(ip), ip).toBe(true)
    }
    for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '::ffff:8.8.8.8']) {
      expect(isPrivateAddress(ip), ip).toBe(false)
    }
    expect(isLoopbackAddress('127.0.0.5')).toBe(true)
    expect(isLoopbackAddress('::1')).toBe(true)
    expect(isLoopbackAddress('10.0.0.1')).toBe(false)
  })

  it('accepts public https URLs only', () => {
    const prod = { allowLoopback: false }
    expect(checkWebhookUrl('https://hooks.example.com/x', prod).ok).toBe(true)
    expect(checkWebhookUrl('https://hooks.example.com:8443/x', prod).ok).toBe(true)
    expect(checkWebhookUrl('http://hooks.example.com/x', prod)).toMatchObject({ ok: false, reason: 'https_required' })
    expect(checkWebhookUrl('https://user:pw@hooks.example.com', prod)).toMatchObject({ ok: false, reason: 'credentials' })
    expect(checkWebhookUrl('https://10.1.2.3/x', prod)).toMatchObject({ ok: false, reason: 'private_address' })
    expect(checkWebhookUrl('https://[::1]/x', prod)).toMatchObject({ ok: false, reason: 'private_address' })
    expect(checkWebhookUrl('https://169.254.169.254/latest', prod)).toMatchObject({ ok: false, reason: 'private_address' })
    expect(checkWebhookUrl('http://localhost:4000/hook', prod)).toMatchObject({ ok: false, reason: 'private_address' })
    expect(checkWebhookUrl('https://intranet/x', prod)).toMatchObject({ ok: false, reason: 'host' })
    expect(checkWebhookUrl('https://db.internal/x', prod)).toMatchObject({ ok: false, reason: 'host' })
    expect(checkWebhookUrl('https://hooks.example.com:22/x', prod)).toMatchObject({ ok: false, reason: 'port' })
    expect(checkWebhookUrl('ftp://x.com', prod)).toMatchObject({ ok: false, reason: 'invalid_url' })
    expect(checkWebhookUrl('nope', prod)).toMatchObject({ ok: false, reason: 'invalid_url' })
  })

  it('allows http to localhost only in development', () => {
    const dev = { allowLoopback: true }
    expect(checkWebhookUrl('http://localhost:4000/hook', dev)).toMatchObject({ ok: true, loopback: true })
    expect(checkWebhookUrl('http://127.0.0.1:4000/hook', dev)).toMatchObject({ ok: true, loopback: true })
    expect(checkWebhookUrl('http://192.168.1.5/hook', dev).ok).toBe(false)
  })
})

describe('event subscriptions', () => {
  it('keeps known events only, * means all', () => {
    expect(normalizeEvents(['order.paid', 'nope', 'message.received', 'order.paid'])).toEqual(['message.received', 'order.paid'])
    expect(normalizeEvents(['*', 'order.paid'])).toEqual(['*'])
    expect(normalizeEvents('order.paid')).toEqual([])
    expect(WEBHOOK_EVENTS).toHaveLength(14)
  })
})

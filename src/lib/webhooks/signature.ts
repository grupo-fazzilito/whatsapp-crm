import { createHmac, randomBytes, timingSafeEqual } from 'crypto'

// Webhook signing. Header:
//   X-Whasalia-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>
// Receivers recompute the HMAC over the raw body and reject old
// timestamps (default tolerance 5 minutes) to stop replays.

export const SIGNATURE_TOLERANCE_SECONDS = 300

export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(32).toString('base64url')}`
}

export function computeSignature(secret: string, timestamp: number, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`, 'utf8').digest('hex')
}

export function signatureHeader(secret: string, body: string, timestamp: number = Math.floor(Date.now() / 1000)): string {
  return `t=${timestamp},v1=${computeSignature(secret, timestamp, body)}`
}

export function parseSignatureHeader(header: string | null | undefined): { t: number; v1: string[] } | null {
  if (!header) return null
  let t: number | null = null
  const v1: string[] = []
  for (const part of header.split(',')) {
    const [k, v] = part.trim().split('=', 2)
    if (k === 't' && /^\d+$/.test(v ?? '')) t = Number(v)
    else if (k === 'v1' && /^[0-9a-f]{64}$/.test(v ?? '')) v1.push(v!)
  }
  return t !== null && v1.length ? { t, v1 } : null
}

/** Receiver-side check (also used by our own tests and docs). */
export function verifySignature(
  secret: string,
  body: string,
  header: string | null | undefined,
  opts: { toleranceSeconds?: number; now?: number } = {},
): boolean {
  const parsed = parseSignatureHeader(header)
  if (!parsed) return false
  const now = opts.now ?? Math.floor(Date.now() / 1000)
  if (Math.abs(now - parsed.t) > (opts.toleranceSeconds ?? SIGNATURE_TOLERANCE_SECONDS)) return false
  const expected = Buffer.from(computeSignature(secret, parsed.t, body), 'hex')
  return parsed.v1.some((sig) => {
    const given = Buffer.from(sig, 'hex')
    return given.length === expected.length && timingSafeEqual(given, expected)
  })
}

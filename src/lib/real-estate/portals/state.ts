import crypto from 'crypto'

// Signed OAuth `state` for portal connections (CSRF protection + which
// workspace / user started the flow):
//   base64url(JSON payload) + "." + base64url(HMAC-SHA256(payload))

export interface PortalOAuthState {
  /** workspace id */
  w: string
  /** user id */
  u: string
  /** provider */
  p: 'mercadolibre'
  /** nonce (also binds the PKCE cookie) */
  n: string
  /** expiry, epoch ms */
  e: number
}

/** httpOnly cookie holding `<nonce>.<code_verifier>` during the OAuth round trip. */
export const PKCE_COOKIE = 'ml_pkce'

export const STATE_TTL_MS = 10 * 60 * 1000

export function portalStateSecret(encryptionKey = process.env.ENCRYPTION_KEY ?? ''): Buffer {
  if (!encryptionKey) throw new Error('ENCRYPTION_KEY is not set')
  return crypto.createHmac('sha256', encryptionKey).update('portal-oauth-state').digest()
}

const mac = (payload: string, secret: Buffer) => crypto.createHmac('sha256', secret).update(payload).digest('base64url')

export function signPortalState(input: Omit<PortalOAuthState, 'n' | 'e'> & Partial<Pick<PortalOAuthState, 'n' | 'e'>>, secret: Buffer, now = Date.now()): string {
  const state: PortalOAuthState = { ...input, n: input.n ?? crypto.randomBytes(12).toString('base64url'), e: input.e ?? now + STATE_TTL_MS }
  const payload = Buffer.from(JSON.stringify(state)).toString('base64url')
  return `${payload}.${mac(payload, secret)}`
}

export type PortalStateCheck = { ok: true; state: PortalOAuthState } | { ok: false; reason: 'malformed' | 'signature' | 'expired' }

export function verifyPortalState(raw: string | null | undefined, secret: Buffer, now = Date.now()): PortalStateCheck {
  if (!raw || typeof raw !== 'string') return { ok: false, reason: 'malformed' }
  const [payload, sig, extra] = raw.split('.')
  if (!payload || !sig || extra !== undefined) return { ok: false, reason: 'malformed' }
  const expected = Buffer.from(mac(payload, secret))
  const given = Buffer.from(sig)
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return { ok: false, reason: 'signature' }
  let state: PortalOAuthState
  try {
    state = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    return { ok: false, reason: 'malformed' }
  }
  if (!state || typeof state.w !== 'string' || typeof state.u !== 'string' || state.p !== 'mercadolibre' || typeof state.n !== 'string' || typeof state.e !== 'number') {
    return { ok: false, reason: 'malformed' }
  }
  if (state.e < now) return { ok: false, reason: 'expired' }
  return { ok: true, state }
}

/** PKCE pair (S256). */
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(48).toString('base64url')
  return { verifier, challenge: crypto.createHash('sha256').update(verifier).digest('base64url') }
}

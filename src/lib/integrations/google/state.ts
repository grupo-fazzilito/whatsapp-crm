import crypto from 'crypto'

// Signed OAuth `state`: proves the callback belongs to a flow we started
// (CSRF) and carries who is connecting which staff calendar.
//   base64url(JSON payload) + "." + base64url(HMAC-SHA256(payload))

/** Page the OAuth round-trip returns to. */
export type GcalReturn = 'staff' | 'profile' | 'integrations'

export interface OAuthState {
  /** workspace id */
  w: string
  /** staff id */
  s: string
  /** user id that started the flow */
  u: string
  /** random nonce */
  n: string
  /** expiry, epoch ms */
  e: number
  /** where to send the user back */
  r?: GcalReturn
}

export const STATE_TTL_MS = 10 * 60 * 1000

/** Key for state HMACs, derived from ENCRYPTION_KEY (never used directly). */
export function stateSecret(encryptionKey = process.env.ENCRYPTION_KEY ?? ''): Buffer {
  if (!encryptionKey) throw new Error('ENCRYPTION_KEY is not set')
  return crypto.createHmac('sha256', encryptionKey).update('google-oauth-state').digest()
}

function mac(payload: string, secret: Buffer): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url')
}

export function signState(
  input: Omit<OAuthState, 'n' | 'e'> & Partial<Pick<OAuthState, 'n' | 'e'>>,
  secret: Buffer,
  now = Date.now(),
): string {
  const state: OAuthState = { ...input, n: input.n ?? crypto.randomBytes(12).toString('base64url'), e: input.e ?? now + STATE_TTL_MS }
  const payload = Buffer.from(JSON.stringify(state)).toString('base64url')
  return `${payload}.${mac(payload, secret)}`
}

export type StateCheck = { ok: true; state: OAuthState } | { ok: false; reason: 'malformed' | 'signature' | 'expired' }

export function verifyState(raw: string | null | undefined, secret: Buffer, now = Date.now()): StateCheck {
  if (!raw || typeof raw !== 'string') return { ok: false, reason: 'malformed' }
  const [payload, sig, extra] = raw.split('.')
  if (!payload || !sig || extra !== undefined) return { ok: false, reason: 'malformed' }
  const expected = Buffer.from(mac(payload, secret))
  const given = Buffer.from(sig)
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return { ok: false, reason: 'signature' }
  let state: OAuthState
  try {
    state = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    return { ok: false, reason: 'malformed' }
  }
  if (!state || typeof state.w !== 'string' || typeof state.s !== 'string' || typeof state.u !== 'string' || typeof state.e !== 'number') {
    return { ok: false, reason: 'malformed' }
  }
  if (state.e < now) return { ok: false, reason: 'expired' }
  return { ok: true, state }
}

/** Constant-time string comparison (webhook channel tokens). */
export function safeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && crypto.timingSafeEqual(x, y)
}

import { createHash, randomBytes, timingSafeEqual } from 'crypto'

// API keys for the public REST API (/api/v1). Format:
//   cnx_live_<43 chars base64url>   (32 random bytes)
// Only sha256(full key) is stored; `prefix` (first 8 chars of the random
// part) is stored in clear to find the row and to show the key in the UI.

export const API_KEY_PREFIX = 'cnx_live_'
const RANDOM_BYTES = 32

export interface GeneratedApiKey {
  secret: string
  prefix: string
  hash: string
}

export function hashApiKey(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex')
}

export function generateApiKey(): GeneratedApiKey {
  const random = randomBytes(RANDOM_BYTES).toString('base64url')
  const secret = `${API_KEY_PREFIX}${random}`
  return { secret, prefix: random.slice(0, 8), hash: hashApiKey(secret) }
}

/** Shape check + prefix extraction. Null when the string can't be one of our keys. */
export function parseApiKey(secret: string | null | undefined): { prefix: string } | null {
  if (!secret || !secret.startsWith(API_KEY_PREFIX)) return null
  const random = secret.slice(API_KEY_PREFIX.length)
  if (!/^[A-Za-z0-9_-]{40,100}$/.test(random)) return null
  return { prefix: random.slice(0, 8) }
}

/** `Authorization: Bearer <key>` → key (or null). */
export function bearerToken(header: string | null | undefined): string | null {
  if (!header) return null
  const m = /^Bearer\s+(\S+)\s*$/i.exec(header)
  return m ? m[1] : null
}

/** Constant-time comparison of a presented key against a stored hash. */
export function keyMatchesHash(secret: string, storedHash: string): boolean {
  const a = Buffer.from(hashApiKey(secret), 'hex')
  const b = Buffer.from(storedHash, 'hex')
  if (a.length !== b.length || a.length === 0) return false
  return timingSafeEqual(a, b)
}

/** What the UI shows for a stored key. */
export function maskedKey(prefix: string): string {
  return `${API_KEY_PREFIX}${prefix}…`
}

// ------------------------------------------------------------
// Scopes
// ------------------------------------------------------------
// `read` = every GET, `write` = every GET + write. Resource scopes grant
// read and write on that resource only. Sending messages needs
// `messages:send` (or `write`).
export const API_SCOPES = [
  'read',
  'write',
  'contacts',
  'conversations',
  'messages:send',
  'catalog',
  'orders',
  'bookings',
  'crm',
] as const
export type ApiScope = (typeof API_SCOPES)[number]

export type ApiResource = Exclude<ApiScope, 'read' | 'write'>
export type ApiAccess = 'read' | 'write'

export function isApiScope(v: unknown): v is ApiScope {
  return typeof v === 'string' && (API_SCOPES as readonly string[]).includes(v)
}

export function normalizeScopes(input: unknown): ApiScope[] {
  const list = Array.isArray(input) ? input.filter(isApiScope) : []
  return API_SCOPES.filter((s) => list.includes(s))
}

export function hasScope(scopes: readonly string[], resource: ApiResource, access: ApiAccess): boolean {
  if (scopes.includes('write')) return true
  if (scopes.includes(resource)) return true
  return access === 'read' && scopes.includes('read')
}

/** Human scope label for errors: "orders (write)". */
export function scopeHint(resource: ApiResource, access: ApiAccess): string {
  return access === 'read' ? `read | ${resource} | write` : `${resource} | write`
}

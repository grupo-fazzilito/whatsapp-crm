import crypto from 'node:crypto'

export interface WebchatSettings {
  color: string
  title: string
  greeting: string
  position: 'right' | 'left'
  allowed_origins: string[]
  prechat_fields: ('name' | 'email' | 'phone')[]
}

const PRECHAT = ['name', 'email', 'phone'] as const

export function newWidgetKey(): string {
  // 18 random bytes = 24 base64url chars.
  return 'pk_' + crypto.randomBytes(18).toString('base64url')
}

function normalizeOrigin(raw: string): string | null {
  const s = raw.trim()
  if (!s) return null
  try {
    const url = new URL(s.includes('://') ? s : `https://${s}`)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    return url.origin
  } catch {
    return null
  }
}

/**
 * Validates widget settings, starting from `base` (current values) so a
 * PATCH can send only what changed. Returns an error message on bad input.
 */
export function parseWebchatSettings(
  input: unknown,
  base?: Partial<WebchatSettings>,
): { ok: true; settings: WebchatSettings } | { ok: false; error: string } {
  const src = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const out: WebchatSettings = {
    color: base?.color ?? '#10b981',
    title: base?.title ?? 'Chat',
    greeting: base?.greeting ?? '',
    position: base?.position ?? 'right',
    allowed_origins: base?.allowed_origins ?? [],
    prechat_fields: base?.prechat_fields ?? [],
  }

  if (src.color !== undefined) {
    if (typeof src.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(src.color)) {
      return { ok: false, error: 'color must be a hex color like #10b981' }
    }
    out.color = src.color.toLowerCase()
  }
  if (src.title !== undefined) {
    if (typeof src.title !== 'string') return { ok: false, error: 'title must be a string' }
    out.title = src.title.trim().slice(0, 60)
  }
  if (src.greeting !== undefined) {
    if (typeof src.greeting !== 'string') return { ok: false, error: 'greeting must be a string' }
    out.greeting = src.greeting.trim().slice(0, 500)
  }
  if (src.position !== undefined) {
    if (src.position !== 'right' && src.position !== 'left') {
      return { ok: false, error: "position must be 'right' or 'left'" }
    }
    out.position = src.position
  }
  if (src.allowed_origins !== undefined) {
    if (!Array.isArray(src.allowed_origins)) return { ok: false, error: 'allowed_origins must be an array' }
    const origins: string[] = []
    for (const o of src.allowed_origins) {
      if (typeof o !== 'string' || !o.trim()) continue
      const n = normalizeOrigin(o)
      if (!n) return { ok: false, error: `Invalid origin: ${o}` }
      if (!origins.includes(n)) origins.push(n)
    }
    out.allowed_origins = origins.slice(0, 20)
  }
  if (src.prechat_fields !== undefined) {
    if (!Array.isArray(src.prechat_fields)) return { ok: false, error: 'prechat_fields must be an array' }
    out.prechat_fields = PRECHAT.filter((f) => (src.prechat_fields as unknown[]).includes(f))
  }
  return { ok: true, settings: out }
}

export function webchatHandle(settings: WebchatSettings): string | null {
  const first = settings.allowed_origins[0]
  if (!first) return null
  try {
    return new URL(first).host
  } catch {
    return null
  }
}

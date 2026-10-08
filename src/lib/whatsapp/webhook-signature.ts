import crypto from 'node:crypto'

/**
 * Verify the HMAC-SHA256 signature Meta attaches to webhook POSTs.
 *
 * Meta signs the raw request body with the App Secret and sends the
 * result in the `x-hub-signature-256: sha256=<hex>` header. Without
 * verification, anyone who knows our webhook URL can POST fabricated
 * messages and status updates.
 *
 * Reference:
 *   https://developers.facebook.com/docs/graph-api/webhooks/getting-started#verify-payloads
 *
 * Contract: the App Secret is **required**. It comes from the admin panel
 * (platform_settings 'meta', encrypted) with META_APP_SECRET as fallback.
 * If neither is set we fail closed — every request is rejected until the
 * operator configures it.
 */
export function verifyMetaSignatureWith(
  rawBody: string,
  signatureHeader: string | null,
  secret: string | null | undefined,
): boolean {
  if (!secret) {
    console.error(
      '[webhook] Meta App Secret is not configured — rejecting request. ' +
        'Set it in the admin panel (Meta / WhatsApp) or META_APP_SECRET ' +
        '(Meta → App Settings → Basic → App Secret).',
    )
    return false
  }

  if (!signatureHeader) return false
  if (!signatureHeader.startsWith('sha256=')) return false

  const expected =
    'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex')

  const a = Buffer.from(signatureHeader)
  const b = Buffer.from(expected)
  // Bail if lengths differ — timingSafeEqual throws otherwise.
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

/** Verifies with the platform App Secret (admin panel → env fallback). */
export async function verifyMetaWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
): Promise<boolean> {
  const { getMetaConfig } = await import('@/lib/platform/meta')
  const { appSecret } = await getMetaConfig()
  return verifyMetaSignatureWith(rawBody, signatureHeader, appSecret)
}

// ------------------------------------------------------------
// Own-app channels (manual setup with the business's own Meta app)
// ------------------------------------------------------------

export type MetaWebhookChannelType = 'whatsapp' | 'messenger' | 'instagram'

/**
 * Account ids a webhook claims to be about, read from the UNTRUSTED body
 * only to know which channel secrets to try. Nothing here is acted upon
 * before a signature check passes.
 *   whatsapp_business_account → value.metadata.phone_number_id
 *   page / instagram          → entry.id (page id / Instagram account id)
 */
export function claimedAccounts(rawBody: string): { type: MetaWebhookChannelType; ids: string[] } | null {
  let body: { object?: unknown; entry?: unknown }
  try {
    body = JSON.parse(rawBody)
  } catch {
    return null
  }
  const entries = Array.isArray(body?.entry) ? (body.entry as Record<string, unknown>[]) : []
  const ids = new Set<string>()
  const type: MetaWebhookChannelType | null =
    body?.object === 'whatsapp_business_account' ? 'whatsapp' : body?.object === 'page' ? 'messenger' : body?.object === 'instagram' ? 'instagram' : null
  if (!type) return null
  for (const e of entries.slice(0, 50)) {
    if (type === 'whatsapp') {
      const changes = Array.isArray(e?.changes) ? (e.changes as { value?: { metadata?: { phone_number_id?: unknown } } }[]) : []
      for (const c of changes.slice(0, 50)) {
        const id = c?.value?.metadata?.phone_number_id
        if (typeof id === 'string' && /^\d{1,32}$/.test(id)) ids.add(id)
      }
    } else if (typeof e?.id === 'string' && /^\d{1,32}$/.test(e.id)) {
      ids.add(e.id)
    }
  }
  return { type, ids: [...ids].slice(0, 20) }
}

export type WebhookTrust =
  | { ok: true; via: 'platform' }
  /** Signed by a channel's own app: only these accounts may be processed. */
  | { ok: true; via: 'channel'; externalIds: string[] }
  | { ok: false }

/** Own-app secrets per external id (decrypted). */
export type ChannelSecretLoader = (type: MetaWebhookChannelType, externalIds: string[]) => Promise<Map<string, string>>

/**
 * Platform App Secret first; otherwise the App Secret of the channels the
 * payload claims to belong to. A payload signed with channel X's own secret
 * is trusted ONLY for the accounts that share that secret — another app
 * can't smuggle events for numbers it doesn't own.
 */
export async function verifyMetaWebhook(
  rawBody: string,
  signatureHeader: string | null,
  deps: { platformSecret: string | null | undefined; loadChannelSecrets: ChannelSecretLoader },
): Promise<WebhookTrust> {
  if (!signatureHeader?.startsWith('sha256=')) return { ok: false }
  if (deps.platformSecret && verifyMetaSignatureWith(rawBody, signatureHeader, deps.platformSecret)) {
    return { ok: true, via: 'platform' }
  }
  const claimed = claimedAccounts(rawBody)
  if (!claimed || claimed.ids.length === 0) return { ok: false }
  const secrets = await deps.loadChannelSecrets(claimed.type, claimed.ids)
  const tried = new Set<string>()
  for (const secret of secrets.values()) {
    if (tried.has(secret)) continue
    tried.add(secret)
    if (verifyMetaSignatureWith(rawBody, signatureHeader, secret)) {
      const externalIds = [...secrets.entries()].filter(([, s]) => s === secret).map(([id]) => id)
      return { ok: true, via: 'channel', externalIds }
    }
  }
  return { ok: false }
}

const SECRET_TTL_MS = 60_000
const secretCache = new Map<string, { at: number; secret: string | null }>()

/** DB loader with a short cache (channel_secrets.app_secret, encrypted). */
export const loadChannelAppSecrets: ChannelSecretLoader = async (type, externalIds) => {
  const out = new Map<string, string>()
  const missing: string[] = []
  for (const id of externalIds) {
    const hit = secretCache.get(`${type}:${id}`)
    if (hit && Date.now() - hit.at < SECRET_TTL_MS) {
      if (hit.secret) out.set(id, hit.secret)
    } else missing.push(id)
  }
  if (missing.length) {
    const [{ supabaseAdmin }, { decrypt }] = await Promise.all([import('@/lib/supabase/admin'), import('./encryption')])
    const { data } = await supabaseAdmin()
      .from('channels')
      .select('external_id, channel_secrets(secrets)')
      .eq('type', type)
      .in('external_id', missing)
    const found = new Map<string, string | null>()
    for (const row of (data ?? []) as { external_id: string; channel_secrets: { secrets: Record<string, string> } | { secrets: Record<string, string> }[] | null }[]) {
      const cs = Array.isArray(row.channel_secrets) ? row.channel_secrets[0] : row.channel_secrets
      const enc = cs?.secrets?.app_secret
      let secret: string | null = null
      if (enc) {
        try {
          secret = decrypt(enc)
        } catch {
          secret = null
        }
      }
      found.set(row.external_id, secret)
    }
    for (const id of missing) {
      const secret = found.get(id) ?? null
      secretCache.set(`${type}:${id}`, { at: Date.now(), secret })
      if (secret) out.set(id, secret)
    }
  }
  return out
}

/** Full check used by /api/webhooks/meta. */
export async function verifyMetaWebhookRequest(rawBody: string, signatureHeader: string | null): Promise<WebhookTrust> {
  const { getMetaConfig } = await import('@/lib/platform/meta')
  const { appSecret } = await getMetaConfig()
  return verifyMetaWebhook(rawBody, signatureHeader, { platformSecret: appSecret, loadChannelSecrets: loadChannelAppSecrets })
}

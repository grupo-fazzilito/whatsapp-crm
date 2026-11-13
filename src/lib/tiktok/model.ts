// TikTok Accounts API (TikTok API for Business, v1.3): pure helpers for the
// OAuth return, webhook signatures and the comment.update event.
//   Docs: business-api.tiktok.com/portal/docs — "Accounts API Authorization",
//   "Authentication", "Comment update event", "Webhook verification".
import crypto from 'node:crypto'

export const TIKTOK_API = 'https://business-api.tiktok.com/open_api/v1.3'

/**
 * The app's "TikTok account holder authorization URL" (portal: My Apps > App
 * Detail > Basic Information) plus our signed `state`. TikTok echoes `state`
 * back to the redirect URL with `auth_code`.
 */
export function authorizeUrl(base: string, state: string): string {
  const url = new URL(base)
  url.searchParams.set('state', state)
  return url.toString()
}

/** Redirect URLs registered in TikTok must be absolute and end with "/". */
export function tiktokRedirectUri(origin: string): string {
  return `${origin.replace(/\/$/, '')}/api/channels/tiktok/oauth/callback/`
}

/**
 * `Tiktok-Signature: t=<unix seconds>,s=<hex HMAC-SHA256(secret, "<t>.<raw body>")>`.
 * Rejects stale deliveries (replays) beyond `maxAgeSec`.
 */
export function verifyTiktokSignature(rawBody: string, header: string | null, secret: string, nowSec = Math.floor(Date.now() / 1000), maxAgeSec = 600): boolean {
  if (!header || !secret) return false
  const parts = Object.fromEntries(
    header.split(',').map((p) => {
      const i = p.indexOf('=')
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()]
    }),
  )
  const t = Number(parts.t)
  const s = parts.s
  if (!Number.isFinite(t) || !s || !/^[0-9a-f]+$/i.test(s)) return false
  if (Math.abs(nowSec - t) > maxAgeSec) return false
  const expected = crypto.createHmac('sha256', secret).update(`${parts.t}.${rawBody}`).digest('hex')
  const a = Buffer.from(expected, 'hex')
  const b = Buffer.from(s, 'hex')
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

export interface TiktokCommentEvent {
  /** The TikTok account (open_id) the comment belongs to. */
  openId: string
  commentId: string
  videoId: string
  parentId: string | null
  type: 'comment' | 'reply'
  action: string
  authorId: string | null
  text: string
}

/**
 * TikTok ids can come as bare JSON numbers longer than 2^53
 * (e.g. 7247303576418566913): quote them before JSON.parse so no digit is lost.
 */
export function quoteBigInts(json: string): string {
  return json.replace(/([:[,]\s*)(-?\d{16,})(?=\s*[,\]}])/g, '$1"$2"')
}

/** A `comment.update` webhook body → the event, or null for anything else. */
export function parseCommentUpdate(body: unknown): TiktokCommentEvent | null {
  const b = (body ?? {}) as Record<string, unknown>
  if (b.event !== 'comment.update' || typeof b.user_openid !== 'string' || typeof b.content !== 'string') return null
  let c: Record<string, unknown>
  try {
    c = JSON.parse(quoteBigInts(b.content)) as Record<string, unknown>
  } catch {
    return null
  }
  const id = (v: unknown) => (typeof v === 'string' && v ? v : typeof v === 'number' ? String(v) : null)
  const commentId = id(c.comment_id)
  const videoId = id(c.video_id)
  if (!commentId || !videoId) return null
  return {
    openId: b.user_openid,
    commentId,
    videoId,
    parentId: id(c.parent_comment_id),
    type: c.comment_type === 'reply' ? 'reply' : 'comment',
    action: typeof c.comment_action === 'string' ? c.comment_action : '',
    authorId: typeof c.unique_identifier === 'string' ? c.unique_identifier : null,
    text: typeof c.text === 'string' ? c.text : '',
  }
}

/** The access token lasts a day: renew it when less than this is left. */
export const REFRESH_MARGIN_MS = 10 * 60 * 1000

export function tokenNeedsRefresh(expiresAt: string | undefined, now = Date.now()): boolean {
  const at = Number(expiresAt)
  return !Number.isFinite(at) || at - now < REFRESH_MARGIN_MS
}

/** TikTok caps a comment reply at 1,200 characters. */
export const TIKTOK_REPLY_MAX = 1200

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

// ------------------------------------------------------------
// Business Messaging API: direct messages
//   Docs: "Webhooks for Business Messaging" (events im_receive_msg,
//   im_send_msg), "Send a message", "Download media".
// ------------------------------------------------------------

/** One direct message from a TikTok webhook (in or out of the business's inbox). */
export interface TiktokDmEvent {
  /** The business account (open_id) the conversation belongs to. */
  openId: string
  /** TikTok's id of the 1:1 conversation: where replies are sent. */
  conversationId: string
  messageId: string
  /** ms epoch */
  timestamp: number
  /** true = written by the business (from the TikTok app, the web, or us through the API). */
  fromBusiness: boolean
  /** API = sent by Whasalia; APP / WEB / OTHERS = by a person from TikTok. */
  source: string | null
  /** The customer's @username (the other side of the conversation). */
  customerUsername: string | null
  contentType: 'text' | 'image' | 'video' | 'sticker'
  text: string | null
  /** For images/videos: what the download endpoint needs. */
  mediaId: string | null
}

const DM_EVENTS = new Set(['im_receive_msg', 'im_send_msg'])

/**
 * `im_receive_msg` / `im_send_msg` webhook body → the message, or null for
 * any other event. EU/UK senders arrive as `im_receive_msg_eu` without
 * content and are ignored (TikTok doesn't share them).
 */
export function parseDirectMessage(body: unknown): TiktokDmEvent | null {
  const b = (body ?? {}) as Record<string, unknown>
  if (typeof b.event !== 'string' || !DM_EVENTS.has(b.event) || typeof b.user_openid !== 'string' || typeof b.content !== 'string') return null
  let c: Record<string, unknown>
  try {
    c = JSON.parse(quoteBigInts(b.content)) as Record<string, unknown>
  } catch {
    return null
  }
  const str = (v: unknown) => (typeof v === 'string' && v ? v : typeof v === 'number' ? String(v) : null)
  const obj = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})
  const conversationId = str(c.conversation_id)
  const messageId = str(c.message_id)
  if (!conversationId || !messageId) return null

  const fromRole = str(obj(c.from_user).role)
  const fromBusiness = b.event === 'im_send_msg' || fromRole === 'business_account'
  const type = str(c.type)?.toLowerCase() ?? 'text'
  const ts = Number(c.timestamp)

  let contentType: TiktokDmEvent['contentType'] = 'text'
  let text: string | null = null
  let mediaId: string | null = null
  switch (type) {
    case 'text':
      text = str(obj(c.text).body)
      break
    case 'image':
      contentType = 'image'
      mediaId = str(obj(c.image).media_id)
      break
    case 'video':
      contentType = 'video'
      mediaId = str(obj(c.video).media_id)
      break
    case 'share_post': {
      const p = obj(c.share_post)
      text = ['🎬', str(p.embed_url) ?? (str(p.video_id) ? `TikTok video ${str(p.video_id)}` : 'TikTok video')].join(' ')
      break
    }
    case 'sticker':
    case 'emoji':
      contentType = 'sticker'
      text = '🙂'
      break
    case 'template': {
      // A tapped button of a card the business sent: its title is what the customer "said".
      const t = obj(c.template)
      text = str(t.title) ?? str(obj(t.button).title) ?? str(c.text) ?? null
      break
    }
    default:
      // Reactions and anything new: nothing to show in the inbox.
      return null
  }
  if (contentType === 'text' && !text) return null

  return {
    openId: b.user_openid,
    conversationId,
    messageId,
    timestamp: Number.isFinite(ts) && ts > 0 ? (ts < 1e12 ? ts * 1000 : ts) : Date.now(),
    fromBusiness,
    source: str(obj(c.message_tag).source),
    customerUsername: fromBusiness ? str(c.to) : str(c.from),
    contentType,
    text,
    mediaId,
  }
}

/** Inbound media of a DM, as the media proxy path segment: `<conversation>~<message>~<media>`, url-safe. */
export const TT_MEDIA_PREFIX = 'tt-media:'

export function encodeDmMedia(ref: { conversationId: string; messageId: string; mediaId: string; mediaType: 'IMAGE' | 'VIDEO' }): string {
  return Buffer.from(JSON.stringify([ref.conversationId, ref.messageId, ref.mediaId, ref.mediaType])).toString('base64url')
}

export function decodeDmMedia(token: string): { conversationId: string; messageId: string; mediaId: string; mediaType: 'IMAGE' | 'VIDEO' } | null {
  try {
    const v = JSON.parse(Buffer.from(token, 'base64url').toString('utf8')) as unknown
    if (!Array.isArray(v) || v.length !== 4 || !v.every((x) => typeof x === 'string' && x)) return null
    const [conversationId, messageId, mediaId, mediaType] = v as string[]
    if (mediaType !== 'IMAGE' && mediaType !== 'VIDEO') return null
    return { conversationId, messageId, mediaId, mediaType }
  } catch {
    return null
  }
}

/** TikTok text messages: up to 6,000 characters. */
export const TIKTOK_DM_MAX = 6000

/** Error codes of /business/message/send/ that mean the reply window is closed. */
export function isDmWindowError(code: number | null, message: string): boolean {
  return code === 40064 || /48[ -]?hour|messag\w* (limit|restrict)|not allowed to send|conversation.*(closed|expired)/i.test(message)
}

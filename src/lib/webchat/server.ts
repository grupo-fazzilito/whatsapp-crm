import 'server-only'
import { createHmac, randomUUID, timingSafeEqual } from 'crypto'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { tenantDb } from '@/lib/db/tenant'
import type { ChannelRow, LoadedChannel } from '@/lib/channels'

// ------------------------------------------------------------
// Visitor tokens
// token = base64url(JSON payload) "." base64url(HMAC-SHA256(payload))
// ------------------------------------------------------------
export interface VisitorTokenPayload {
  /** channel id */
  c: string
  /** visitor id (contact_identities.external_id for channel_type 'webchat') */
  v: string
  /** issued at, unix seconds */
  iat: number
}

const TOKEN_MAX_AGE_S = 60 * 60 * 24 * 365

let _secret: Buffer | null = null
function secret(): Buffer {
  if (_secret) return _secret
  const explicit = process.env.WEBCHAT_SECRET
  if (explicit) {
    _secret = Buffer.from(explicit, 'utf8')
  } else {
    const base = process.env.ENCRYPTION_KEY
    if (!base) throw new Error('WEBCHAT_SECRET or ENCRYPTION_KEY must be set')
    // Domain-separated sub-key so the encryption key itself never signs tokens.
    _secret = createHmac('sha256', Buffer.from(base, 'utf8')).update('webchat-visitor-token-v1').digest()
  }
  return _secret
}

function sign(data: string): string {
  return createHmac('sha256', secret()).update(data).digest('base64url')
}

export function newVisitorId(): string {
  return randomUUID()
}

export function signVisitorToken(channelId: string, visitorId: string): string {
  const payload: VisitorTokenPayload = { c: channelId, v: visitorId, iat: Math.floor(Date.now() / 1000) }
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  return `${body}.${sign(body)}`
}

export function verifyVisitorToken(token: unknown): VisitorTokenPayload | null {
  if (typeof token !== 'string' || token.length > 512) return null
  const dot = token.indexOf('.')
  if (dot <= 0) return null
  const body = token.slice(0, dot)
  const sig = Buffer.from(token.slice(dot + 1), 'base64url')
  const expected = Buffer.from(sign(body), 'base64url')
  if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) return null
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as VisitorTokenPayload
    if (typeof p.c !== 'string' || typeof p.v !== 'string' || typeof p.iat !== 'number') return null
    const now = Math.floor(Date.now() / 1000)
    if (p.iat > now + 300 || now - p.iat > TOKEN_MAX_AGE_S) return null
    return p
  } catch {
    return null
  }
}

// ------------------------------------------------------------
// Channels
// ------------------------------------------------------------
export interface WebchatSettings {
  title?: string
  color?: string
  greeting?: string
  position?: 'left' | 'right'
  allowed_origins?: string[]
  prechat_fields?: string[]
}

export function settingsOf(channel: ChannelRow): WebchatSettings {
  return (channel.settings ?? {}) as WebchatSettings
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Web chat has no provider credentials, so secrets are always empty.
function asLoaded(row: ChannelRow | null): LoadedChannel | null {
  return row ? { ...row, secrets: {} } : null
}

export async function webchatChannelByKey(key: unknown): Promise<LoadedChannel | null> {
  if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{4,128}$/.test(key)) return null
  // Platform lookup: the workspace is only known once the channel is found.
  const data = await prisma.channels.findFirst({ where: { type: 'webchat', external_id: key } })
  return asLoaded(data as unknown as ChannelRow | null)
}

export async function webchatChannelById(id: string): Promise<LoadedChannel | null> {
  if (!UUID.test(id)) return null
  // Platform lookup: the id comes from a signed visitor token.
  const data = await prisma.channels.findFirst({ where: { type: 'webchat', id } })
  return asLoaded(data as unknown as ChannelRow | null)
}

/**
 * Resolves a visitor token into its (connected) channel. Returns an error
 * response when the token is bad, the channel is gone/disabled or the
 * request origin isn't allowed for that channel.
 */
export async function resolveVisitor(
  req: Request,
  token: unknown,
): Promise<
  | { ok: true; channel: LoadedChannel; visitorId: string; cors: HeadersInit }
  | { ok: false; response: NextResponse }
> {
  const origin = req.headers.get('origin')
  const payload = verifyVisitorToken(token)
  if (!payload) return { ok: false, response: wcJson({ error: 'invalid_token' }, 401, anyOriginCors(origin)) }
  const channel = await webchatChannelById(payload.c)
  const gate = gateChannel(req, channel)
  if (!gate.ok) return gate
  return { ok: true, channel: channel!, visitorId: payload.v, cors: gate.cors }
}

/** Channel must exist, be connected and accept the request origin. */
export function gateChannel(
  req: Request,
  channel: LoadedChannel | null,
): { ok: true; cors: HeadersInit } | { ok: false; response: NextResponse } {
  const origin = req.headers.get('origin')
  if (!channel || channel.status !== 'connected') {
    return { ok: false, response: wcJson({ error: 'not_found' }, 404, anyOriginCors(origin)) }
  }
  if (!originAllowed(channel, origin)) {
    // No ACAO header: the browser blocks the response as well.
    return { ok: false, response: wcJson({ error: 'origin_not_allowed' }, 403, { Vary: 'Origin' }) }
  }
  return { ok: true, cors: channelCors(origin) }
}

// ------------------------------------------------------------
// CORS
// ------------------------------------------------------------
function normalizeOrigin(o: string): string {
  return o.trim().toLowerCase().replace(/\/+$/, '')
}

/**
 * allowed_origins entries are full origins ("https://shop.com") or a
 * wildcard subdomain ("https://*.shop.com"). Empty list = any origin.
 * Requests without Origin (server-to-server, same-origin GET) pass.
 */
export function originAllowed(channel: ChannelRow, origin: string | null): boolean {
  const list = (settingsOf(channel).allowed_origins ?? []).filter((x) => typeof x === 'string' && x.trim())
  if (!list.length || !origin) return true
  const o = normalizeOrigin(origin)
  return list.some((entry) => {
    const e = normalizeOrigin(entry)
    if (e === o) return true
    const m = e.match(/^(https?:\/\/)\*\.(.+)$/)
    return !!m && o.startsWith(m[1]) && o.slice(m[1].length).endsWith('.' + m[2])
  })
}

const BASE_CORS = {
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Last-Event-ID',
  'Access-Control-Max-Age': '600',
  Vary: 'Origin',
}

function channelCors(origin: string | null): HeadersInit {
  return { ...BASE_CORS, 'Access-Control-Allow-Origin': origin || '*' }
}

/** For responses not tied to a channel (errors, preflight). No credentials ever. */
export function anyOriginCors(origin: string | null): HeadersInit {
  return { ...BASE_CORS, 'Access-Control-Allow-Origin': origin || '*' }
}

/** Preflight: we can't know the channel yet (no body), the real response enforces it. */
export function preflight(req: Request): Response {
  return new Response(null, { status: 204, headers: anyOriginCors(req.headers.get('origin')) })
}

export function wcJson(body: unknown, status = 200, headers: HeadersInit = {}): NextResponse {
  return NextResponse.json(body, { status, headers: { ...headers, 'Cache-Control': 'no-store' } })
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0].trim()
  return req.headers.get('x-real-ip') || 'unknown'
}

// ------------------------------------------------------------
// Visitor conversation & messages
// ------------------------------------------------------------
export async function visitorContactId(channel: ChannelRow, visitorId: string): Promise<string | null> {
  const data = await tenantDb(channel.workspace_id).contact_identities.findFirst({
    select: { contact_id: true },
    where: { workspace_id: channel.workspace_id, channel_type: 'webchat', external_id: visitorId },
  })
  return data?.contact_id ?? null
}

export async function visitorConversationId(channel: ChannelRow, visitorId: string): Promise<string | null> {
  const contactId = await visitorContactId(channel, visitorId)
  if (!contactId) return null
  const data = await tenantDb(channel.workspace_id).conversations.findFirst({
    select: { id: true },
    where: { workspace_id: channel.workspace_id, channel_id: channel.id, contact_id: contactId },
    orderBy: { created_at: 'asc' },
  })
  return data?.id ?? null
}

export interface PublicMessage {
  id: string
  sender_type: 'customer' | 'agent' | 'bot'
  content_type: string
  content_text: string | null
  media_url: string | null
  metadata: Record<string, unknown>
  created_at: string
}

// Only what the widget needs: never leak flow ids, errors, agent ids,
// order/cart ids. Button ids (cart:add:<productId>, pay:<methodId>...) are
// what the visitor sends back, so they stay.
const PUBLIC_METADATA_KEYS = ['options', 'sections', 'button_label', 'header', 'footer', 'filename']

export interface PublicCard {
  imageUrl: string | null
  title: string
  subtitle?: string
  buttons: { id: string; title: string }[]
}

/** Carousel cards reduced to what the widget renders. */
export function publicCards(v: unknown): PublicCard[] | undefined {
  if (!Array.isArray(v)) return undefined
  const str = (x: unknown, max: number) => (typeof x === 'string' && x ? x.slice(0, max) : undefined)
  const cards = v.slice(0, 10).flatMap((c): PublicCard[] => {
    if (!c || typeof c !== 'object') return []
    const card = c as Record<string, unknown>
    const title = str(card.title, 200)
    if (!title) return []
    const img = str(card.imageUrl, 2048)
    const buttons = (Array.isArray(card.buttons) ? card.buttons : []).slice(0, 3).flatMap((b) => {
      const r = (b ?? {}) as Record<string, unknown>
      const id = str(r.id, 200)
      const t = str(r.title, 40)
      return id && t ? [{ id, title: t }] : []
    })
    return [{ imageUrl: img && /^https?:\/\//i.test(img) ? img : null, title, subtitle: str(card.subtitle, 300), buttons }]
  })
  return cards.length ? cards : undefined
}

export function publicMessage(row: Record<string, unknown>): PublicMessage {
  const meta = (row.metadata ?? {}) as Record<string, unknown>
  const metadata: Record<string, unknown> = {}
  for (const k of PUBLIC_METADATA_KEYS) if (meta[k] !== undefined) metadata[k] = meta[k]
  const cards = publicCards(meta.cards)
  if (cards) metadata.cards = cards
  return {
    id: row.id as string,
    sender_type: row.sender_type as PublicMessage['sender_type'],
    content_type: row.content_type as string,
    content_text: (row.content_text as string | null) ?? null,
    media_url: (row.media_url as string | null) ?? null,
    metadata,
    created_at: row.created_at as string,
  }
}

/** Overlap used for "after" cursors: rows can commit slightly out of created_at order. Clients dedupe by id. */
export const CURSOR_OVERLAP_MS = 10_000

export async function visitorMessages(
  channel: ChannelRow,
  conversationId: string,
  after: string | null,
  limit = 100,
): Promise<PublicMessage[]> {
  const db = tenantDb(channel.workspace_id)
  const select = {
    id: true, sender_type: true, content_type: true, content_text: true, media_url: true,
    metadata: true, created_at: true, status: true, is_internal: true,
  } as const
  const where = {
    workspace_id: channel.workspace_id,
    conversation_id: conversationId,
    sender_type: { in: ['customer', 'agent', 'bot'] },
    content_type: { not: 'system' },
    status: { not: 'failed' },
    // Internal notes are team-only: never shown to the visitor.
    is_internal: false,
  }
  const afterMs = after ? Date.parse(after) : NaN
  if (!Number.isNaN(afterMs)) {
    const data = await db.messages.findMany({
      select,
      where: { ...where, created_at: { gt: new Date(afterMs - CURSOR_OVERLAP_MS).toISOString() } },
      orderBy: { created_at: 'asc' },
      take: limit,
    })
    return (data as Record<string, unknown>[]).filter(isVisible).map(publicMessage)
  }
  const data = await db.messages.findMany({ select, where, orderBy: { created_at: 'desc' }, take: limit })
  return (data as Record<string, unknown>[]).filter(isVisible).reverse().map(publicMessage)
}

function isVisible(row: Record<string, unknown>): boolean {
  const meta = (row.metadata ?? {}) as Record<string, unknown>
  return row.is_internal !== true && !meta.internal && !meta.is_note && !meta.note
}

export function cleanText(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const t = v.replace(/\u0000/g, '').trim()
  return t ? t.slice(0, max) : null
}

/** Adds permissive CORS headers to a response built elsewhere (e.g. 429s) so the widget can read it. */
export function withCors(res: Response, req: Request): Response {
  for (const [k, v] of Object.entries(anyOriginCors(req.headers.get('origin')) as Record<string, string>)) {
    res.headers.set(k, v)
  }
  return res
}

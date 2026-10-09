import 'server-only'
import crypto from 'node:crypto'
import { NextResponse } from 'next/server'
import { tenantDb } from '@/lib/db/tenant'
import { isPrismaError } from '@/lib/db/errors'
import { isUuid } from '@/lib/workspace/constants'
import type { ChannelRow } from '@/lib/channels/types'
import { getMetaConfig, metaAppReady } from '@/lib/platform/meta'

// Helpers shared by the /api/channels routes (private folder: not a route).

export const GRAPH = 'https://graph.facebook.com/v21.0'

/** Columns safe to send to the browser (never secrets). */
export const PUBLIC_COLUMNS =
  'id, workspace_id, type, name, purpose, external_id, display_handle, status, status_detail, settings, ai_agent_id, created_at, updated_at'

/** PUBLIC_COLUMNS as a Prisma `select`. */
export const PUBLIC_SELECT = {
  id: true,
  workspace_id: true,
  type: true,
  name: true,
  purpose: true,
  external_id: true,
  display_handle: true,
  status: true,
  status_detail: true,
  settings: true,
  ai_agent_id: true,
  created_at: true,
  updated_at: true,
} as const

export function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

export const CONFLICT_MESSAGE = 'This account is already connected (maybe in another workspace).'

/** Unique violation: a Prisma P2002 error or a Postgres/PostgREST error with code 23505. */
export function isUniqueViolation(error: unknown) {
  return isPrismaError(error, 'P2002') || (error as { code?: string } | null | undefined)?.code === '23505'
}

/** Platform Meta app configured (admin panel → env fallback). */
export async function metaOAuthAvailable(): Promise<boolean> {
  return metaAppReady(await getMetaConfig())
}

export function str(v: unknown, max = 500): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  return s ? s.slice(0, max) : null
}

/** Dev-only escape hatch so the API can be exercised without real credentials. */
export function skipVerify(request: Request) {
  return process.env.NODE_ENV !== 'production' && new URL(request.url).searchParams.get('skip_verify') === '1'
}

export async function graphGet<T>(path: string, accessToken: string): Promise<T> {
  const sep = path.includes('?') ? '&' : '?'
  const res = await fetch(`${GRAPH}/${path}${sep}access_token=${encodeURIComponent(accessToken)}`, {
    cache: 'no-store',
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data?.error) throw new Error(data?.error?.message ?? `Meta API error: ${res.status}`)
  return data as T
}

/** Subscribe our app to a Facebook page's messaging webhooks (Messenger + Instagram DMs). */
export async function subscribePage(pageId: string, pageToken: string): Promise<string | null> {
  const fields = 'messages,messaging_postbacks,message_reactions,message_deliveries'
  try {
    const res = await fetch(
      `${GRAPH}/${encodeURIComponent(pageId)}/subscribed_apps?subscribed_fields=${fields}&access_token=${encodeURIComponent(pageToken)}`,
      { method: 'POST' },
    )
    const data = await res.json().catch(() => ({}))
    if (!res.ok || data?.error) return data?.error?.message ?? `Meta API error: ${res.status}`
    return null
  } catch (err) {
    return err instanceof Error ? err.message : 'Subscription failed'
  }
}

/** Subscribe our app to a WhatsApp Business Account's webhooks. Best effort. */
export async function subscribeWaba(wabaId: string, accessToken: string): Promise<string | null> {
  try {
    const res = await fetch(`${GRAPH}/${encodeURIComponent(wabaId)}/subscribed_apps`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || data?.error) return data?.error?.message ?? `Meta API error: ${res.status}`
    return null
  } catch (err) {
    return err instanceof Error ? err.message : 'Subscription failed'
  }
}

// ------------------------------------------------------------
// Signed / encrypted payloads (ENCRYPTION_KEY)
// ------------------------------------------------------------

function key(): Buffer {
  const hex = process.env.ENCRYPTION_KEY
  if (!hex) throw new Error('ENCRYPTION_KEY is not set')
  return Buffer.from(hex, 'hex')
}

export function sign(payload: object): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const mac = crypto.createHmac('sha256', key()).update(`state:${body}`).digest('base64url')
  return `${body}.${mac}`
}

export function verifySigned<T>(token: string | null | undefined): T | null {
  if (!token) return null
  const [body, mac] = token.split('.')
  if (!body || !mac) return null
  const expected = crypto.createHmac('sha256', key()).update(`state:${body}`).digest('base64url')
  const a = Buffer.from(mac)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T
  } catch {
    return null
  }
}

/** AES-256-GCM, base64url (compact enough for a cookie). */
export function seal(payload: object): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv)
  const ct = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64url')
}

export function unseal<T>(sealed: string | null | undefined): T | null {
  if (!sealed) return null
  try {
    const buf = Buffer.from(sealed, 'base64url')
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(), buf.subarray(0, 12))
    decipher.setAuthTag(buf.subarray(12, 28))
    const pt = Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()])
    return JSON.parse(pt.toString('utf8')) as T
  } catch {
    return null
  }
}

// ------------------------------------------------------------
// Meta OAuth candidate pages (kept in an encrypted httpOnly cookie)
// ------------------------------------------------------------

export const META_PAGES_COOKIE = 'meta_pages'
const CHUNK = 3500
const MAX_CHUNKS = 8

export interface MetaCandidatePage {
  id: string
  name: string
  token: string
  ig: { id: string; username: string | null } | null
}

export interface MetaCandidates {
  ws: string
  uid: string
  exp: number
  pages: MetaCandidatePage[]
}

/** Split into ≤3.5 KB cookies (browsers cap each cookie at ~4 KB). */
export function candidateCookies(data: MetaCandidates): { name: string; value: string }[] {
  const sealed = seal(data)
  const parts: { name: string; value: string }[] = []
  for (let i = 0; i * CHUNK < sealed.length && i < MAX_CHUNKS; i++) {
    parts.push({ name: `${META_PAGES_COOKIE}_${i}`, value: sealed.slice(i * CHUNK, (i + 1) * CHUNK) })
  }
  if (parts.length * CHUNK < sealed.length) throw new Error('Too many pages to connect at once')
  return parts
}

export function readCandidates(get: (name: string) => string | undefined): MetaCandidates | null {
  let sealed = ''
  for (let i = 0; i < MAX_CHUNKS; i++) {
    const part = get(`${META_PAGES_COOKIE}_${i}`)
    if (!part) break
    sealed += part
  }
  const data = unseal<MetaCandidates>(sealed)
  if (!data || data.exp < Date.now()) return null
  return data
}

export function candidateCookieNames(): string[] {
  return Array.from({ length: MAX_CHUNKS }, (_, i) => `${META_PAGES_COOKIE}_${i}`)
}

export const META_COOKIE_PATH = '/api/channels/meta'

export async function assertAgentInWorkspace(workspaceId: string, agentId: string): Promise<boolean> {
  // Non-uuid ids made PostgREST fail (no row); Prisma would throw.
  if (!isUuid(agentId)) return false
  const data = await tenantDb(workspaceId).ai_agents.findFirst({ select: { id: true }, where: { id: agentId, workspace_id: workspaceId } })
  return !!data
}

export type PublicChannel = ChannelRow

export const META_SCOPES = [
  'pages_show_list',
  'pages_messaging',
  'pages_manage_metadata',
  'instagram_basic',
  'instagram_manage_messages',
  'business_management',
]

/** Must be identical in the dialog request and the code exchange. */
export function metaRedirectUri(request: { nextUrl: URL }) {
  return `${request.nextUrl.origin}/api/channels/meta/oauth/callback`
}

import { tenantDb } from '@/lib/db/tenant'
import { isPrismaError } from '@/lib/db/errors'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import {
  anyOriginCors,
  cleanText,
  clientIp,
  gateChannel,
  newVisitorId,
  preflight,
  signVisitorToken,
  verifyVisitorToken,
  visitorContactId,
  visitorConversationId,
  wcJson,
  webchatChannelByKey,
  withCors,
} from '@/lib/webchat/server'
import type { LoadedChannel } from '@/lib/channels'

export function OPTIONS(req: Request) {
  return preflight(req)
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * POST /api/webchat/session {key, visitor_token?, name?, email?, phone?}
 * → {visitor_token, conversation_id}
 * Reuses the visitor of a valid token for the same channel, otherwise
 * issues a new visitor id. Pre-chat details create/update the contact.
 */
export async function POST(req: Request) {
  const ip = clientIp(req)
  const rl = checkRateLimit(`wc:session:ip:${ip}`, { limit: 20, windowMs: 60_000 })
  if (!rl.success) return withCors(rateLimitResponse(rl), req)

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return wcJson({ error: 'invalid_body' }, 400, anyOriginCors(req.headers.get('origin')))

  const channel = await webchatChannelByKey(body.key)
  const gate = gateChannel(req, channel)
  if (!gate.ok) return gate.response
  const ch = channel!

  const prev = verifyVisitorToken(body.visitor_token)
  const visitorId = prev && prev.c === ch.id ? prev.v : newVisitorId()
  const token = prev && prev.c === ch.id ? (body.visitor_token as string) : signVisitorToken(ch.id, visitorId)

  const name = cleanText(body.name, 120)
  const emailRaw = cleanText(body.email, 200)
  const email = emailRaw && EMAIL.test(emailRaw) ? emailRaw.toLowerCase() : null
  const phoneRaw = cleanText(body.phone, 40)
  const phone = phoneRaw && /^[+()\d\s.-]{5,40}$/.test(phoneRaw) ? phoneRaw : null

  if (name || email || phone) {
    const err = await upsertVisitorContact(ch, visitorId, { name, email, phone })
    if (err) return wcJson({ error: 'contact_failed' }, 500, gate.cors)
  }

  const conversationId = await visitorConversationId(ch, visitorId)
  return wcJson({ visitor_token: token, conversation_id: conversationId }, 200, gate.cors)
}

/**
 * Creates the contact + webchat identity (if the visitor has none yet) or
 * fills in the details. A visitor never gets linked to an existing contact
 * by phone/email: they could type someone else's.
 */
async function upsertVisitorContact(
  channel: LoadedChannel,
  visitorId: string,
  details: { name: string | null; email: string | null; phone: string | null },
): Promise<string | null> {
  const ws = channel.workspace_id
  const db = tenantDb(ws)
  const patch = Object.fromEntries(Object.entries(details).filter(([, v]) => v)) as Record<string, string>
  const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

  const existing = await visitorContactId(channel, visitorId)
  if (existing) {
    try {
      await db.contacts.updateMany({ where: { id: existing, workspace_id: ws }, data: { ...patch, updated_at: new Date().toISOString() } })
      return null
    } catch (err) {
      return message(err)
    }
  }

  let created: { id: string }
  try {
    created = await db.contacts.create({
      data: { workspace_id: ws, name: details.name || `webchat ${visitorId.slice(-4)}`, email: details.email, phone: details.phone },
      select: { id: true },
    })
  } catch (err) {
    return message(err)
  }

  try {
    await db.contact_identities.create({
      data: {
        workspace_id: ws,
        contact_id: created.id,
        channel_type: 'webchat',
        external_id: visitorId,
        handle: details.email ?? details.name ?? null,
      },
    })
  } catch (idErr) {
    // Concurrent request created the identity first: keep that contact.
    await db.contacts.deleteMany({ where: { id: created.id, workspace_id: ws } }).catch(() => {})
    if (!isPrismaError(idErr, 'P2002')) return message(idErr)
    const winner = await visitorContactId(channel, visitorId)
    if (winner) await db.contacts.updateMany({ where: { id: winner, workspace_id: ws }, data: patch }).catch(() => {})
  }
  return null
}

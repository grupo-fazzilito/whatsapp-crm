import { randomUUID } from 'crypto'
import { ingestMessage } from '@/lib/messaging/ingest'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import {
  anyOriginCors,
  cleanText,
  clientIp,
  preflight,
  resolveVisitor,
  visitorConversationId,
  visitorMessages,
  wcJson,
  withCors,
} from '@/lib/webchat/server'

export const maxDuration = 60

const MAX_TEXT = 2000

export function OPTIONS(req: Request) {
  return preflight(req)
}

/**
 * POST /api/webchat/messages {visitor_token, text, reply_id?}
 * → {message_id, conversation_id}
 * Stored through the same ingest pipeline as every channel (AI agent →
 * flows → automations run before this returns).
 */
export async function POST(req: Request) {
  const ip = clientIp(req)
  const ipRl = checkRateLimit(`wc:msg:ip:${ip}`, { limit: 60, windowMs: 60_000 })
  if (!ipRl.success) return withCors(rateLimitResponse(ipRl), req)

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  const cors = anyOriginCors(req.headers.get('origin'))
  if (!body) return wcJson({ error: 'invalid_body' }, 400, cors)

  const v = await resolveVisitor(req, body.visitor_token)
  if (!v.ok) return v.response

  const visitorRl = checkRateLimit(`wc:msg:v:${v.visitorId}`, { limit: 20, windowMs: 60_000 })
  if (!visitorRl.success) return withCors(rateLimitResponse(visitorRl), req)

  if (typeof body.text === 'string' && body.text.trim().length > MAX_TEXT) {
    return wcJson({ error: 'text_too_long', max: MAX_TEXT }, 413, v.cors)
  }
  const text = cleanText(body.text, MAX_TEXT)
  if (!text) return wcJson({ error: 'empty_text' }, 400, v.cors)
  const replyId = cleanText(body.reply_id, 200)

  const outcome = await ingestMessage(v.channel, {
    kind: 'message',
    channelExternalId: v.channel.external_id,
    from: { externalId: v.visitorId },
    externalMessageId: `wc_${randomUUID()}`,
    timestamp: Date.now(),
    contentType: replyId ? 'interactive' : 'text',
    text,
    interactiveReplyId: replyId,
  })
  if (!outcome?.messageId) return wcJson({ error: 'store_failed' }, 500, v.cors)

  return wcJson({ message_id: outcome.messageId, conversation_id: outcome.conversationId }, 200, v.cors)
}

/**
 * GET /api/webchat/messages?visitor_token=…&after=<iso>
 * → {conversation_id, messages: PublicMessage[]}
 * Without `after`: the latest 100. With it: messages created after
 * (after − 10 s) — the overlap absorbs commit-order races; dedupe by id.
 */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const v = await resolveVisitor(req, url.searchParams.get('visitor_token'))
  if (!v.ok) return v.response

  const rl = checkRateLimit(`wc:poll:v:${v.visitorId}`, { limit: 40, windowMs: 60_000 })
  if (!rl.success) return withCors(rateLimitResponse(rl), req)
  const ipRl = checkRateLimit(`wc:poll:ip:${clientIp(req)}`, { limit: 300, windowMs: 60_000 })
  if (!ipRl.success) return withCors(rateLimitResponse(ipRl), req)

  const conversationId = await visitorConversationId(v.channel, v.visitorId)
  const messages = conversationId
    ? await visitorMessages(v.channel, conversationId, url.searchParams.get('after'))
    : []
  return wcJson({ conversation_id: conversationId, messages }, 200, v.cors)
}

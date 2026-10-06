import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import {
  clientIp,
  preflight,
  resolveVisitor,
  visitorConversationId,
  visitorMessages,
  withCors,
} from '@/lib/webchat/server'

// The stream closes itself before this; clients reconnect.
export const maxDuration = 60

const POLL_MS = 1500
const HEARTBEAT_MS = 15_000
const LIFETIME_MS = 55_000

export function OPTIONS(req: Request) {
  return preflight(req)
}

/**
 * GET /api/webchat/stream?visitor_token=…&after=<iso>
 * text/event-stream of the visitor's conversation messages:
 *   data: PublicMessage JSON   (id: = created_at, usable as next `after`)
 *   event: bye                 (sent right before the server closes, ~55 s)
 * plus `: ping` heartbeats every 15 s.
 */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const v = await resolveVisitor(req, url.searchParams.get('visitor_token'))
  if (!v.ok) return v.response

  const rl = checkRateLimit(`wc:stream:v:${v.visitorId}`, { limit: 12, windowMs: 60_000 })
  if (!rl.success) return withCors(rateLimitResponse(rl), req)
  const ipRl = checkRateLimit(`wc:stream:ip:${clientIp(req)}`, { limit: 120, windowMs: 60_000 })
  if (!ipRl.success) return withCors(rateLimitResponse(ipRl), req)

  const { channel, visitorId } = v
  let cursor = req.headers.get('last-event-id') || url.searchParams.get('after') || new Date().toISOString()
  if (Number.isNaN(Date.parse(cursor))) cursor = new Date().toISOString()

  const encoder = new TextEncoder()
  const seen = new Set<string>()
  let closed = false
  let timer: ReturnType<typeof setTimeout> | null = null

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const startedAt = Date.now()
      let lastWrite = Date.now()
      let conversationId: string | null = null

      const write = (chunk: string) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(chunk))
          lastWrite = Date.now()
        } catch {
          stop()
        }
      }
      const stop = () => {
        if (closed) return
        closed = true
        if (timer) clearTimeout(timer)
        try {
          controller.close()
        } catch {
          // already closed by the runtime
        }
      }
      req.signal.addEventListener('abort', stop)

      write('retry: 3000\n: connected\n\n')

      const tick = async () => {
        if (closed) return
        if (Date.now() - startedAt >= LIFETIME_MS) {
          write(`event: bye\ndata: {"after":${JSON.stringify(cursor)}}\n\n`)
          return stop()
        }
        try {
          conversationId ??= await visitorConversationId(channel, visitorId)
          if (conversationId) {
            const rows = await visitorMessages(channel, conversationId, cursor)
            for (const m of rows) {
              if (seen.has(m.id)) continue
              seen.add(m.id)
              if (Date.parse(m.created_at) > Date.parse(cursor)) cursor = m.created_at
              write(`id: ${cursor}\ndata: ${JSON.stringify(m)}\n\n`)
            }
          }
        } catch (err) {
          console.error('[webchat/stream] poll failed:', err)
        }
        if (Date.now() - lastWrite >= HEARTBEAT_MS) write(': ping\n\n')
        if (!closed) timer = setTimeout(tick, POLL_MS)
      }
      void tick()
    },
    cancel() {
      closed = true
      if (timer) clearTimeout(timer)
    },
  })

  return new Response(stream, {
    headers: {
      ...(v.cors as Record<string, string>),
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}

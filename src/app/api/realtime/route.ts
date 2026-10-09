import { requireWorkspace } from '@/lib/workspace/context'
import { subscribe } from '@/lib/realtime/hub'
import type { RealtimeChange } from '@/lib/realtime/types'

export const dynamic = 'force-dynamic'

/**
 * GET /api/realtime — Server-Sent Events with row changes of the active
 * workspace (messages, conversations, notifications, orders, tasks…).
 * Each event: `event: change` + JSON RealtimeChange. Comment pings every
 * 25 s keep proxies from closing the connection.
 */
export async function GET(request: Request) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { workspace, user } = guard.ctx
  const encoder = new TextEncoder()
  let cleanup = () => {}

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (s: string) => {
        try {
          controller.enqueue(encoder.encode(s))
        } catch {
          cleanup()
        }
      }
      let unsubscribe = () => {}
      const ping = setInterval(() => write(': ping\n\n'), 25_000)
      cleanup = () => {
        clearInterval(ping)
        unsubscribe()
      }
      request.signal.addEventListener('abort', () => {
        cleanup()
        try {
          controller.close()
        } catch {
          // already closed
        }
      })
      try {
        unsubscribe = await subscribe({
          workspaceId: workspace.id,
          userId: user.id,
          send: (change: RealtimeChange) => write(`event: change\ndata: ${JSON.stringify(change)}\n\n`),
        })
        write(`retry: 3000\nevent: ready\ndata: {"workspace_id":"${workspace.id}"}\n\n`)
      } catch (err) {
        console.error('[realtime] subscribe failed:', err instanceof Error ? err.message : err)
        cleanup()
        controller.close()
      }
    },
    cancel() {
      cleanup()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}

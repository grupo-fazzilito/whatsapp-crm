import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { resendDelivery } from '@/lib/webhooks/deliver'

/** POST — re-sends a delivery now (new delivery row, same event id). */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const limit = checkRateLimit(`webhook-resend:${guard.ctx.user.id}`, { limit: 20, windowMs: 60_000 })
  if (!limit.success) return rateLimitResponse(limit)
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const result = await resendDelivery(guard.ctx.workspace.id, id)
  if ('error' in result && !('deliveryId' in result)) {
    return NextResponse.json({ error: result.error }, { status: result.error === 'not_found' ? 404 : 409 })
  }
  return NextResponse.json({ result })
}

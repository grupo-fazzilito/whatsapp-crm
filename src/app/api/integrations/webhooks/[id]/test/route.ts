import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { sendTestPing } from '@/lib/webhooks/deliver'

/** POST — sends a signed `ping` event now and returns the result. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const limit = checkRateLimit(`webhook-test:${guard.ctx.user.id}`, { limit: 10, windowMs: 60_000 })
  if (!limit.success) return rateLimitResponse(limit)
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const result = await sendTestPing(guard.ctx.workspace.id, id)
  if (!result) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ result })
}

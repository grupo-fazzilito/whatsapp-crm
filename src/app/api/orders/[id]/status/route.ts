import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'
import { updateOrderStatus } from '@/lib/orders/service'
import type { OrderStatus } from '@/lib/orders/texts'

/**
 * POST /api/orders/[id]/status {status, reason?, notify?} — any member.
 * Confirm reserves stock (409 {error:'out_of_stock:<name>'} when short),
 * cancel restores it. notify defaults to the workspace setting.
 */
const STATUSES = new Set<OrderStatus>(['pending', 'confirmed', 'preparing', 'ready', 'shipped', 'delivered', 'cancelled'])

export async function POST(request: Request, ctx: RouteContext<'/api/orders/[id]/status'>) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { user, workspace } = guard.ctx

  const { id } = await ctx.params
  if (!isUuid(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const status = body?.status
  if (typeof status !== 'string' || !STATUSES.has(status as OrderStatus) || status === 'pending') {
    return NextResponse.json({ error: 'invalid_status' }, { status: 400 })
  }
  const reason = typeof body?.reason === 'string' && body.reason.trim() ? body.reason.trim().slice(0, 300) : null
  const notify = typeof body?.notify === 'boolean' ? body.notify : undefined

  try {
    const result = await updateOrderStatus({
      workspaceId: workspace.id,
      orderId: id,
      status: status as OrderStatus,
      userId: user.id,
      reason,
      notify,
    })
    if (!result.ok) {
      const code = result.error === 'not_found' ? 404 : 409
      return NextResponse.json({ error: result.error }, { status: code })
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[orders] status update failed:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

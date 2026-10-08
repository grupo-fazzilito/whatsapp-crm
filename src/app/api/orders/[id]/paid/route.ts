import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'
import { markOrderPaid } from '@/lib/orders/service'

/** POST /api/orders/[id]/paid {notify?} — any member marks the order as paid. */
export async function POST(request: Request, ctx: RouteContext<'/api/orders/[id]/paid'>) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { user, workspace } = guard.ctx

  const { id } = await ctx.params
  if (!isUuid(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown> | null
  const notify = typeof body?.notify === 'boolean' ? body.notify : true

  try {
    const result = await markOrderPaid(workspace.id, id, user.id, notify)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.error === 'not_found' ? 404 : 409 })
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[orders] mark paid failed:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

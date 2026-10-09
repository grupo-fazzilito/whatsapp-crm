import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'

/** GET ?status=pending|delivered|failed — the 50 most recent deliveries of the endpoint. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const status = new URL(request.url).searchParams.get('status')
  try {
    const data = await guard.ctx.db.webhook_deliveries.findMany({
      select: {
        id: true,
        event_id: true,
        event_type: true,
        payload: true,
        status: true,
        attempts: true,
        next_attempt_at: true,
        last_attempt_at: true,
        response_status: true,
        response_body: true,
        error: true,
        duration_ms: true,
        created_at: true,
      },
      where: {
        workspace_id: guard.ctx.workspace.id,
        endpoint_id: id,
        ...(status && ['pending', 'delivered', 'failed'].includes(status) ? { status } : {}),
      },
      orderBy: { created_at: 'desc' },
      take: 50,
    })
    return NextResponse.json({ deliveries: data })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}

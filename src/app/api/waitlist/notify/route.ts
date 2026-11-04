import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'
import { notifyWaitlist } from '@/lib/waitlist/server'

/** POST /api/waitlist/notify { ids } → { sent, failed: [{ id, reason }] } — the "back in stock" WhatsApp. */
export async function POST(request: Request) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { workspace, user } = guard.ctx
  const body = (await request.json().catch(() => null)) as { ids?: unknown } | null
  const ids = Array.isArray(body?.ids) ? [...new Set(body.ids.filter((id): id is string => typeof id === 'string' && isUuid(id)))] : []
  if (!ids.length) return NextResponse.json({ error: 'ids' }, { status: 400 })
  const result = await notifyWaitlist(workspace, user.id, ids)
  return NextResponse.json(result)
}

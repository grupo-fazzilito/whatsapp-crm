import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { listWaitlist } from '@/lib/waitlist/server'

/** GET /api/waitlist?status=waiting|notified → { groups } (the template: GET /api/waitlist/template). */
export async function GET(request: Request) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const status = new URL(request.url).searchParams.get('status') === 'notified' ? 'notified' : 'waiting'
  return NextResponse.json({ groups: await listWaitlist(guard.ctx.workspace.id, status) })
}

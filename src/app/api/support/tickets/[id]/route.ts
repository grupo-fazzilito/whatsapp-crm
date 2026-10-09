import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'
import { customerClose, getTicket } from '@/lib/support/tickets'

type Ctx = { params: Promise<{ id: string }> }

/** GET → { ticket, messages }. PATCH { status: 'closed' } closes it. */
export async function GET(_r: Request, { params }: Ctx) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { id } = await params
  const found = isUuid(id) ? await getTicket(guard.ctx.workspace.id, id) : null
  return found ? NextResponse.json(found) : NextResponse.json({ error: 'not_found' }, { status: 404 })
}

export async function PATCH(request: Request, { params }: Ctx) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { id } = await params
  const body = (await request.json().catch(() => null)) as { status?: unknown } | null
  if (body?.status !== 'closed') return NextResponse.json({ error: 'invalid_status' }, { status: 400 })
  if (!isUuid(id) || !(await customerClose(guard.ctx.workspace.id, id))) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json(await getTicket(guard.ctx.workspace.id, id))
}

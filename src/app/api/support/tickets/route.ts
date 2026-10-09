import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { parseNewTicket } from '@/lib/support/input'
import { createTicket, listTickets } from '@/lib/support/tickets'

/** GET → { tickets } of the active business. POST { subject, category, priority, body, attachments? } → { ticket } */
export async function GET() {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  return NextResponse.json({ tickets: await listTickets(guard.ctx.workspace.id) })
}

export async function POST(request: Request) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  const parsed = parseNewTicket(body, guard.ctx.workspace.id)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const ticket = await createTicket({ workspaceId: guard.ctx.workspace.id, userId: guard.ctx.user.id, ticket: parsed.value })
  return NextResponse.json({ ticket }, { status: 201 })
}

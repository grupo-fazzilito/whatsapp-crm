import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'
import { parseAttachments, parseBody } from '@/lib/support/input'
import { customerReply } from '@/lib/support/tickets'

/** POST { body, attachments? } → { ticket, messages } — reply from the business (reopens the ticket). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const raw = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const body = parseBody(raw?.body)
  if (!body) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  const attachments = parseAttachments(raw?.attachments, guard.ctx.workspace.id)
  if (typeof attachments === 'string') return NextResponse.json({ error: 'invalid_attachments' }, { status: 400 })
  const result = await customerReply({ workspaceId: guard.ctx.workspace.id, userId: guard.ctx.user.id, ticketId: id, body, attachments })
  return result ? NextResponse.json(result) : NextResponse.json({ error: 'not_found' }, { status: 404 })
}

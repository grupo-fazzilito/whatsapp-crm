import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'
import { inviteFromConversation, subscriberStateFor } from '@/lib/messenger-marketing/server'

/** GET ?conversation=<id> → { messenger, status, connected } for the inbox button. */
export async function GET(request: Request) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const id = new URL(request.url).searchParams.get('conversation') ?? ''
  if (!isUuid(id)) return NextResponse.json({ messenger: false, status: null, connected: false })
  return NextResponse.json(await subscriberStateFor(guard.ctx.workspace.id, id))
}

/** POST { conversation_id } (any member) → sends the "Get our offers" request in that Messenger chat. */
export async function POST(request: Request) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const body = (await request.json().catch(() => null)) as { conversation_id?: unknown } | null
  const id = typeof body?.conversation_id === 'string' && isUuid(body.conversation_id) ? body.conversation_id : null
  if (!id) return NextResponse.json({ error: 'invalid' }, { status: 400 })
  const r = await inviteFromConversation(guard.ctx.workspace.id, id)
  if (!r.ok) return NextResponse.json({ error: r.error, message: r.message }, { status: r.error === 'failed' ? 502 : 409 })
  return NextResponse.json({ ok: true })
}

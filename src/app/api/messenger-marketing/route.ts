import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { disconnectMarketing, messengerStatus } from '@/lib/messenger-marketing/server'

/** GET → connection, subscribers and settings of Messenger marketing messages. */
export async function GET() {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  return NextResponse.json(await messengerStatus(guard.ctx.workspace.id))
}

/** DELETE (admins) → disconnects the ad account (subscribers are kept). */
export async function DELETE() {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  await disconnectMarketing(guard.ctx.workspace.id)
  return NextResponse.json({ ok: true })
}

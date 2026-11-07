import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { getPublishingConfig, publishingReady } from '@/lib/social/config'
import { disconnectAll, listAccounts } from '@/lib/social/server'

/** GET → { accounts, available } (available = the platform's publishing app is set up). */
export async function GET() {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  return NextResponse.json({ accounts: await listAccounts(guard.ctx.workspace.id), available: publishingReady(await getPublishingConfig()) })
}

/** DELETE → disconnects the page and its Instagram account (admins). */
export async function DELETE() {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  await disconnectAll(guard.ctx.workspace.id)
  return NextResponse.json({ ok: true })
}

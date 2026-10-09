import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { inboxDirectory } from '@/lib/inbox/queries'

/** GET /api/inbox/directory → { channels, agents: [{id, name, enabled}], members: Profile[] (active members) } */
export async function GET() {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  try {
    return NextResponse.json(await inboxDirectory(guard.ctx.db))
  } catch (err) {
    console.error('[inbox] directory failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Failed to load directory' }, { status: 500 })
  }
}

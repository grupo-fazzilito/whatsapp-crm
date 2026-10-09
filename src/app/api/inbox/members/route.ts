import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { activeMemberNames } from '@/lib/inbox/queries'

/** GET /api/inbox/members → { members: [{user_id, full_name, email}] } (active members) */
export async function GET() {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  try {
    return NextResponse.json({ members: await activeMemberNames(guard.ctx.db) })
  } catch (err) {
    console.error('[inbox] members failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Failed to load members' }, { status: 500 })
  }
}

import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { broadcastQuota } from '@/lib/broadcasts/free-limit'

/** GET (members) → { limit, used, remaining, resets_at }: broadcast recipients this month (limit null on the paid plan). */
export async function GET() {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  try {
    return NextResponse.json(await broadcastQuota(guard.ctx.workspace.id))
  } catch (err) {
    console.error('[broadcasts] quota failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'failed' }, { status: 500 })
  }
}

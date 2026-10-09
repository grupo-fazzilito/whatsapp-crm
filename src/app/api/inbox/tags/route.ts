import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { listTags } from '@/lib/inbox/queries'

/** GET /api/inbox/tags → { tags } (workspace tags by name) */
export async function GET() {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  try {
    return NextResponse.json({ tags: await listTags(guard.ctx.db) })
  } catch (err) {
    console.error('[inbox] tags failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Failed to load tags' }, { status: 500 })
  }
}

import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'

/** GET /api/crm/tags — any member. The workspace's tags by name. → { tags } */
export async function GET() {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  try {
    return NextResponse.json({ tags: await guard.ctx.db.tags.findMany({ orderBy: { name: 'asc' } }) })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}

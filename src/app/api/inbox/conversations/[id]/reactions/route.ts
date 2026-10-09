import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'
import { listReactions } from '@/lib/inbox/queries'

/** GET /api/inbox/conversations/[id]/reactions → { reactions } */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  try {
    return NextResponse.json({ reactions: await listReactions(guard.ctx.db, id) })
  } catch (err) {
    console.error('[inbox] reactions failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Failed to load reactions' }, { status: 500 })
  }
}

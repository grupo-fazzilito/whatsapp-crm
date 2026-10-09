import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'

/**
 * GET /api/pipelines/[id]/deals → { deals } newest first, each with
 * `contact` and `assignee` (profile of assigned_to) — any member.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ deals: [] })
  try {
    const rows = await guard.ctx.db.deals.findMany({
      where: { pipeline_id: id },
      include: { contacts: true, profiles: true },
      orderBy: { created_at: 'desc' },
    })
    const deals = rows.map(({ contacts, profiles, ...d }) => ({ ...d, contact: contacts, assignee: profiles }))
    return NextResponse.json({ deals })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}

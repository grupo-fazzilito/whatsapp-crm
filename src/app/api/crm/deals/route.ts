import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { parseDealInput } from '@/lib/crm/server'

const DEAL_SELECT = { id: true, title: true, value: true, currency: true, pipeline_id: true, stage_id: true, status: true } as const

/**
 * POST /api/crm/deals { pipeline_id, stage_id, title, contact_id?, conversation_id?,
 * value?, currency?, assigned_to? (profile id), expected_close_date?, notes? } — any member.
 * → { deal: { id, title, value, currency, pipeline_id, stage_id, status } }
 */
export async function POST(request: Request) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { db, workspace, user } = guard.ctx
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'invalid' }, { status: 400 })
  const parsed = await parseDealInput(db, body, 'create')
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const d = parsed.data
  try {
    const deal = await db.deals.create({
      data: {
        ...d,
        workspace_id: workspace.id,
        user_id: user.id,
        title: d.title as string,
        pipeline_id: d.pipeline_id as string,
        stage_id: d.stage_id as string,
        status: 'open',
      },
      select: DEAL_SELECT,
    })
    return NextResponse.json({ deal }, { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}

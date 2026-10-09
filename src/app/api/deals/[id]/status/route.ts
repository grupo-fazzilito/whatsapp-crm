import { NextResponse } from 'next/server'
import type { Prisma } from '@/generated/prisma/client'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'

const STATUSES = new Set(['open', 'won', 'lost'])
const clip = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().replace(/\s+/g, ' ').slice(0, max) : null)

/**
 * POST /api/deals/[id]/status {status: 'won'|'lost'|'open', reason?, note?} — any member.
 * Lost requires a reason (from workspaces.settings.crm.lost_reasons or free
 * text for "Otro"). won_at / lost_at are stamped by the deals trigger;
 * reopening clears them.
 */
export async function POST(request: Request, ctx: RouteContext<'/api/deals/[id]/status'>) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { db, workspace } = guard.ctx

  const { id } = await ctx.params
  if (!isUuid(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const status = typeof body?.status === 'string' ? body.status : ''
  if (!STATUSES.has(status)) return NextResponse.json({ error: 'invalid_status' }, { status: 400 })
  const reason = clip(body?.reason, 200)
  const note = typeof body?.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 2000) : null
  if (status === 'lost' && !reason) return NextResponse.json({ error: 'reason_required' }, { status: 400 })

  const patch: Prisma.dealsUpdateManyMutationInput = { status }
  if (status === 'lost') Object.assign(patch, { lost_reason: reason, close_note: note })
  if (status === 'won') Object.assign(patch, { close_note: note })

  let data
  try {
    const [row] = await db.deals.updateManyAndReturn({
      where: { id, workspace_id: workspace.id },
      data: patch,
      select: { id: true, status: true, won_at: true, lost_at: true, lost_reason: true, close_note: true },
    })
    data = row ?? null
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to update deal' }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ deal: data })
}

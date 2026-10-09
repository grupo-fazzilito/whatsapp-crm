import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { invalidateBusinessContext } from '@/lib/ai/context'
import { parseHours } from '@/lib/business/setup-input'
import { badRequest, errorResponse, readBody } from '@/lib/business/setup-server'

const HOURS_SELECT = { day_name: true, opening_time: true, closing_time: true, is_closed: true, break_start: true, break_end: true } as const

/**
 * GET /api/business/hours → { hours } (members)
 * PUT /api/business/hours { hours: { day_name, opening_time, closing_time, is_closed, break_start, break_end }[] } (admins)
 *   Upserts one row per day. → { ok }
 */
export async function GET() {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  try {
    const hours = await guard.ctx.db.business_hours.findMany({ select: HOURS_SELECT })
    return NextResponse.json({ hours })
  } catch (err) {
    return errorResponse('business/hours', err)
  }
}

export async function PUT(request: Request) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const body = await readBody(request)
  if (!body) return badRequest('Invalid JSON body')
  const { db, workspace } = guard.ctx
  try {
    const rows = parseHours(body.hours)
    const now = new Date()
    for (const r of rows) {
      await db.business_hours.upsert({
        where: { workspace_id_day_name: { workspace_id: workspace.id, day_name: r.day_name } },
        create: { ...r, workspace_id: workspace.id, updated_at: now },
        update: { ...r, updated_at: now },
      })
    }
    invalidateBusinessContext(workspace.id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return errorResponse('business/hours', err)
  }
}

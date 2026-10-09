import { NextResponse } from 'next/server'
import type { Prisma } from '@/generated/prisma/client'
import { requireWorkspace } from '@/lib/workspace/context'
import { normalizeReasons } from '@/lib/crm/reasons'

/**
 * PUT /api/crm/lost-reasons { reasons: string[] | null } — admins.
 * Saves workspaces.settings.crm.lost_reasons (null = back to the defaults),
 * merged into the latest settings.
 */
export async function PUT(request: Request) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const { db, workspace } = guard.ctx
  const body = (await request.json().catch(() => null)) as { reasons?: unknown } | null
  if (!body || (body.reasons !== null && !Array.isArray(body.reasons))) return NextResponse.json({ error: 'invalid' }, { status: 400 })
  try {
    const row = await db.workspaces.findFirst({ select: { settings: true }, where: { id: workspace.id } })
    if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    const base = (row.settings && typeof row.settings === 'object' && !Array.isArray(row.settings) ? row.settings : {}) as Record<string, unknown>
    const crm = { ...((base.crm && typeof base.crm === 'object' ? base.crm : {}) as Record<string, unknown>) }
    if (body.reasons) crm.lost_reasons = normalizeReasons(body.reasons)
    else delete crm.lost_reasons
    await db.workspaces.update({ where: { id: workspace.id }, data: { settings: { ...base, crm } as Prisma.InputJsonValue } })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}

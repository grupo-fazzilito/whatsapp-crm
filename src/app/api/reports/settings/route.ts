import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { validSla, validUsdRate } from '@/lib/reports/settings'
import { saveReportSettings } from '@/lib/reports/service'

/**
 * PATCH /api/reports/settings — admins. Body: {sla_minutes?: int 1..1440,
 * usd_rate?: number > 0 | null (null = currency default)}.
 */
export async function PATCH(request: Request) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'invalid_body' }, { status: 400 })

  const patch: { sla_minutes?: number; usd_rate?: number | null } = {}
  if ('sla_minutes' in body) {
    if (!validSla(body.sla_minutes)) return NextResponse.json({ error: 'invalid_sla' }, { status: 400 })
    patch.sla_minutes = body.sla_minutes
  }
  if ('usd_rate' in body) {
    if (body.usd_rate !== null && !validUsdRate(body.usd_rate)) return NextResponse.json({ error: 'invalid_rate' }, { status: 400 })
    patch.usd_rate = body.usd_rate as number | null
  }
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })

  try {
    const reports = await saveReportSettings(guard.ctx.workspace.id, patch)
    return NextResponse.json({ reports })
  } catch (err) {
    console.error('[reports] settings save failed:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

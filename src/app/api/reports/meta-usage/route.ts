import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { monthBounds } from '@/lib/meta-usage/rates'
import { loadMetaUsage } from '@/lib/reports/meta-usage-data'

/**
 * GET /api/reports/meta-usage?month=YYYY-MM (admins)
 * Per WhatsApp number: service replies vs. Meta's 1,000 free per month,
 * templates by category, and the estimated Meta charge (USD + workspace
 * currency). Meta bills the business directly; this is an estimate.
 */
export async function GET(request: Request) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const { workspace, db } = guard.ctx
  const bounds = monthBounds(new URL(request.url).searchParams.get('month'))
  if (!bounds) return NextResponse.json({ error: 'invalid_month' }, { status: 400 })

  try {
    return NextResponse.json(await loadMetaUsage(workspace, db, bounds))
  } catch (err) {
    console.error('[meta-usage] failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'failed' }, { status: 500 })
  }
}

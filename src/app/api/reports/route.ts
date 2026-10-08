import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { hasRole, isUuid } from '@/lib/workspace/constants'
import { isPreset, resolveRange } from '@/lib/reports/range'
import { buildReport } from '@/lib/reports/service'

/**
 * GET /api/reports?preset=today|7d|30d|month|custom&from=YYYY-MM-DD&to=YYYY-MM-DD
 *                 &channel=<uuid>&agent=<uuid>&team=<uuid>
 * Admins/owners get the whole workspace; agents get their personal view
 * (forced agent = self, no AI cost / sales). Dates are local days in the
 * workspace time zone.
 */
export async function GET(request: Request) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { user, workspace, role } = guard.ctx

  const url = new URL(request.url)
  const q = (k: string) => url.searchParams.get(k)
  const preset = q('preset') ?? '7d'
  if (!isPreset(preset)) return NextResponse.json({ error: 'invalid_range' }, { status: 400 })
  const range = resolveRange(preset, workspace.timezone, new Date(), { from: q('from'), to: q('to') })
  if (!range) return NextResponse.json({ error: 'invalid_range' }, { status: 400 })

  const ids: Record<'channel' | 'agent' | 'team', string | null> = { channel: null, agent: null, team: null }
  for (const k of ['channel', 'agent', 'team'] as const) {
    const v = q(k)
    if (v) {
      if (!isUuid(v)) return NextResponse.json({ error: 'invalid_filter' }, { status: 400 })
      ids[k] = v
    }
  }

  try {
    const result = await buildReport({
      workspace,
      userId: user.id,
      scope: hasRole(role, 'admin') ? 'workspace' : 'personal',
      range,
      channelId: ids.channel,
      agentId: ids.agent,
      teamId: ids.team,
    })
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
    return NextResponse.json(result.report, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    console.error('[reports] build failed:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

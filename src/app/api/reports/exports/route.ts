import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { hasRole, isUuid } from '@/lib/workspace/constants'
import { isPreset, resolveRange } from '@/lib/reports/range'
import { queueReportExport } from '@/lib/reports/exports'

/** Most PDFs a person can have in progress at once. */
const MAX_PENDING = 3

/**
 * POST { preset, from?, to?, channel?, agent?, team?, lang? } — queues the
 * PDF of the report with those filters (same rules as GET /api/reports:
 * agents get their personal view). → 202 { id }. The requester is notified
 * in the app when it is ready.
 */
export async function POST(request: Request) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { user, workspace, role, db } = guard.ctx
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const str = (k: string) => (typeof body?.[k] === 'string' && body[k] ? (body[k] as string) : null)
  const preset = str('preset') ?? '7d'
  if (!isPreset(preset)) return NextResponse.json({ error: 'invalid_range' }, { status: 400 })
  if (!resolveRange(preset, workspace.timezone, new Date(), { from: str('from'), to: str('to') })) return NextResponse.json({ error: 'invalid_range' }, { status: 400 })
  const ids: Record<'channel' | 'agent' | 'team', string | null> = { channel: null, agent: null, team: null }
  for (const k of ['channel', 'agent', 'team'] as const) {
    const v = str(k)
    if (v) {
      if (!isUuid(v)) return NextResponse.json({ error: 'invalid_filter' }, { status: 400 })
      ids[k] = v
    }
  }
  const pending = await db.report_exports.count({ where: { user_id: user.id, status: 'pending', created_at: { gt: new Date(Date.now() - 30 * 60_000) } } })
  if (pending >= MAX_PENDING) return NextResponse.json({ error: 'too_many' }, { status: 429 })
  try {
    const id = await queueReportExport(workspace.id, user.id, {
      preset,
      from: str('from'),
      to: str('to'),
      channelId: ids.channel,
      agentId: ids.agent,
      teamId: ids.team,
      scope: hasRole(role, 'admin') ? 'workspace' : 'personal',
      locale: str('lang') === 'en' ? 'en' : 'es',
    })
    return NextResponse.json({ id }, { status: 202 })
  } catch (err) {
    console.error('[reports] export queue failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'failed' }, { status: 500 })
  }
}

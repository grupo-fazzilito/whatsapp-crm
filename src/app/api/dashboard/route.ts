import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import {
  loadActivity,
  loadConversationsSeries,
  loadMetrics,
  loadPipelineDonut,
  loadResponseTime,
  type DashboardScope,
} from '@/lib/dashboard/queries'
import { safeTimeZone } from '@/lib/dashboard/zoned'

const RANGES = new Set([7, 30, 90])

/**
 * GET /api/dashboard?section=…&tz=<IANA zone of the viewer> — any member.
 *   metrics        → { metrics: MetricsBundle }
 *   series&range=7|30|90 → { series: ConversationsSeriesPoint[] }
 *   pipeline       → { pipeline: PipelineDonutData }
 *   response-time  → { responseTime: ResponseTimeSummary }
 *   activity&limit=1..100 → { activity: ActivityItem[] }
 * Day boundaries ("today", chart days, weekdays) use `tz` (default UTC).
 */
export async function GET(request: Request) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { db, workspace } = guard.ctx

  const url = new URL(request.url)
  const scope: DashboardScope = { db, workspaceId: workspace.id, tz: safeTimeZone(url.searchParams.get('tz')) }

  try {
    switch (url.searchParams.get('section')) {
      case 'metrics':
        return NextResponse.json({ metrics: await loadMetrics(scope) })
      case 'series': {
        const range = Number(url.searchParams.get('range') ?? 30)
        if (!RANGES.has(range)) return NextResponse.json({ error: 'invalid_range' }, { status: 400 })
        return NextResponse.json({ series: await loadConversationsSeries(scope, range) })
      }
      case 'pipeline':
        return NextResponse.json({ pipeline: await loadPipelineDonut(scope) })
      case 'response-time':
        return NextResponse.json({ responseTime: await loadResponseTime(scope) })
      case 'activity': {
        const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 20, 1), 100)
        return NextResponse.json({ activity: await loadActivity(scope, limit) })
      }
      default:
        return NextResponse.json({ error: 'invalid_section' }, { status: 400 })
    }
  } catch (err) {
    console.error('[dashboard] load failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Failed to load dashboard data' }, { status: 500 })
  }
}

import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { hasRole } from '@/lib/workspace/constants'
import { resolveIndustry } from '@/lib/industries'
import { safeTimeZone } from '@/lib/dashboard/zoned'
import { loadKpis } from '@/lib/dashboard/kpis'
import { KPI_WIDGETS, widgetAvailable, type WidgetId } from '@/lib/dashboard/widgets'

/** GET /api/dashboard/widgets?ids=a,b&tz=<viewer zone> → { data: { [id]: … } } (KPI widgets only). */
export async function GET(request: Request) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { db, workspace, user, role } = guard.ctx
  const url = new URL(request.url)
  const modules = resolveIndustry(workspace.industry, workspace.settings).modules
  const ctx = { isAdmin: hasRole(role, 'admin'), modules: { bookings: modules.bookings, orders: modules.orders }, industry: workspace.industry }
  const ids = (url.searchParams.get('ids') ?? '')
    .split(',')
    .filter((x): x is WidgetId => (KPI_WIDGETS as string[]).includes(x))
    .filter((id) => widgetAvailable(id, ctx))
  try {
    const data = await loadKpis(ids, {
      db,
      workspaceId: workspace.id,
      tz: safeTimeZone(url.searchParams.get('tz')),
      userId: user.id,
      businessTz: safeTimeZone(workspace.timezone),
      currency: workspace.currency || 'USD',
    })
    return NextResponse.json({ data })
  } catch (err) {
    console.error('[dashboard/widgets] failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'failed' }, { status: 500 })
  }
}

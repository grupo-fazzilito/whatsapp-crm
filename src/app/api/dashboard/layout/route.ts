import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { hasRole } from '@/lib/workspace/constants'
import { resolveIndustry } from '@/lib/industries'
import { defaultLayout, sanitizeLayout } from '@/lib/dashboard/widgets'

async function widgetCtx() {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return { guard, ctx: null }
  const { workspace, role } = guard.ctx
  const modules = resolveIndustry(workspace.industry, workspace.settings).modules
  return { guard, ctx: { isAdmin: hasRole(role, 'admin'), modules: { bookings: modules.bookings, orders: modules.orders }, industry: workspace.industry } }
}

/** GET → { widgets, customized }   PUT { widgets: string[] | null } (null = back to default). Per user and business. */
export async function GET() {
  const { guard, ctx } = await widgetCtx()
  if (!guard.ok || !ctx) return guard.ok ? NextResponse.json({ error: 'failed' }, { status: 500 }) : guard.response
  const { db, workspace, user } = guard.ctx
  const row = await db.dashboard_layouts.findFirst({ where: { workspace_id: workspace.id, user_id: user.id } })
  return NextResponse.json(row ? { widgets: sanitizeLayout(row.widgets, ctx), customized: true } : { widgets: defaultLayout(ctx), customized: false })
}

export async function PUT(request: Request) {
  const { guard, ctx } = await widgetCtx()
  if (!guard.ok || !ctx) return guard.ok ? NextResponse.json({ error: 'failed' }, { status: 500 }) : guard.response
  const { db, workspace, user } = guard.ctx
  const body = (await request.json().catch(() => null)) as { widgets?: unknown } | null
  if (!body || !('widgets' in body)) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  if (body.widgets === null) {
    await db.dashboard_layouts.deleteMany({ where: { workspace_id: workspace.id, user_id: user.id } })
    return NextResponse.json({ widgets: defaultLayout(ctx), customized: false })
  }
  if (!Array.isArray(body.widgets)) return NextResponse.json({ error: 'invalid_widgets' }, { status: 400 })
  const widgets = sanitizeLayout(body.widgets, ctx)
  await db.dashboard_layouts.upsert({
    where: { workspace_id_user_id: { workspace_id: workspace.id, user_id: user.id } },
    create: { workspace_id: workspace.id, user_id: user.id, widgets },
    update: { widgets, updated_at: new Date().toISOString() },
  })
  return NextResponse.json({ widgets, customized: true })
}

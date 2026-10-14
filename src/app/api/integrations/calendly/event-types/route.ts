import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'
import { prisma } from '@/lib/db/prisma'
import { invalidateBusinessContext } from '@/lib/ai/context'
import { syncEventTypes } from '@/lib/integrations/calendly/sync'

/** PUT { mappings: [{ id, service_id|null, staff_id|null }] } (admins) — which service each Calendly event type books. */
export async function PUT(request: Request) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const ws = guard.ctx.workspace.id
  const body = (await request.json().catch(() => null)) as { mappings?: { id?: unknown; service_id?: unknown; staff_id?: unknown }[] } | null
  if (!Array.isArray(body?.mappings)) return NextResponse.json({ error: 'mappings is required' }, { status: 400 })
  const opt = (v: unknown) => (v === null || v === '' || v === undefined ? null : typeof v === 'string' && isUuid(v) ? v : undefined)

  const db = guard.ctx.db
  const [services, staff] = await Promise.all([db.services.findMany({ select: { id: true } }), db.staff.findMany({ select: { id: true } })])
  const serviceIds = new Set(services.map((s) => s.id))
  const staffIds = new Set(staff.map((s) => s.id))
  const used = new Set<string>()
  for (const m of body!.mappings) {
    const service = opt(m.service_id)
    const member = opt(m.staff_id)
    if (typeof m.id !== 'string' || !isUuid(m.id) || service === undefined || member === undefined) return NextResponse.json({ error: 'invalid mapping' }, { status: 400 })
    if ((service && !serviceIds.has(service)) || (member && !staffIds.has(member))) return NextResponse.json({ error: 'unknown service or staff' }, { status: 400 })
    if (service && used.has(service)) return NextResponse.json({ error: 'service_used_twice' }, { status: 400 })
    if (service) used.add(service)
  }
  await prisma.$transaction(
    body!.mappings.map((m) => prisma.calendly_event_types.updateMany({ where: { id: m.id as string, workspace_id: ws }, data: { service_id: opt(m.service_id) ?? null, staff_id: opt(m.staff_id) ?? null } })),
  )
  invalidateBusinessContext(ws)
  return NextResponse.json({ ok: true })
}

/** POST (admins) — re-reads the event types from Calendly. */
export async function POST() {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const c = await prisma.calendly_connections.findUnique({ where: { workspace_id: guard.ctx.workspace.id }, select: { id: true } })
  if (!c) return NextResponse.json({ error: 'not_connected' }, { status: 404 })
  await syncEventTypes(c.id)
  return NextResponse.json({ ok: true })
}

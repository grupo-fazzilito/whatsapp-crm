import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { prisma } from '@/lib/db/prisma'
import { getCalendlyConfig } from '@/lib/integrations/calendly/config'

/** GET (admins) → { configured, connection, event_types, services, staff } for Settings → Integrations. */
export async function GET() {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const ws = guard.ctx.workspace.id
  const db = guard.ctx.db
  const [cfg, connection, eventTypes, services, staff] = await Promise.all([
    getCalendlyConfig(),
    prisma.calendly_connections.findUnique({
      where: { workspace_id: ws },
      select: { email: true, name: true, scheduling_url: true, status: true, last_error: true, can_book: true, webhook_uri: true, webhooks_available: true, last_synced_at: true, created_at: true },
    }),
    prisma.calendly_event_types.findMany({ where: { workspace_id: ws }, select: { id: true, name: true, duration_minutes: true, active: true, scheduling_url: true, service_id: true, staff_id: true }, orderBy: [{ active: 'desc' }, { name: 'asc' }] }),
    db.services.findMany({ where: { is_active: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    db.staff.findMany({ where: { is_active: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
  ])
  return NextResponse.json({
    configured: !!cfg,
    connection: connection ? { ...connection, webhook_active: !!connection.webhook_uri } : null,
    event_types: eventTypes,
    services,
    staff,
  })
}

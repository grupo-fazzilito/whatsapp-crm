import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { hasRole } from '@/lib/workspace/constants'
import { getGoogleConfig } from '@/lib/integrations/google/config'

/**
 * GET — Google Calendar status for the active workspace: whether the
 * platform has an OAuth client, every staff connection (status fields
 * only, never tokens) and the staff row linked to the current user.
 */
export async function GET() {
  const guard = await requireWorkspace()
  if (!guard.ok) return guard.response
  const { user, role, db } = guard.ctx
  const [cfg, conns, mine] = await Promise.all([
    getGoogleConfig(),
    db.calendar_connections
      .findMany({
        select: { id: true, staff_id: true, google_email: true, status: true, last_error: true, last_synced_at: true, watch_expires_at: true, created_at: true },
      })
      .catch(() => null),
    db.staff.findFirst({ select: { id: true, name: true }, where: { member_user_id: user.id } }).catch(() => null),
  ])
  const pending = await db.bookings
    .findMany({ select: { staff_id: true }, where: { google_sync_state: 'error' }, take: 200 })
    .catch(() => null)
  const errorsByStaff: Record<string, number> = {}
  for (const r of pending ?? []) if (r.staff_id) errorsByStaff[r.staff_id] = (errorsByStaff[r.staff_id] ?? 0) + 1

  return NextResponse.json({
    configured: !!cfg,
    can_manage_all: hasRole(role, 'admin'),
    my_staff: mine ?? null,
    connections: (conns ?? []).map((c) => ({ ...c, sync_errors: errorsByStaff[c.staff_id] ?? 0 })),
  })
}

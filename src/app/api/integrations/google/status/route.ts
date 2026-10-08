import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { hasRole } from '@/lib/workspace/constants'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getGoogleConfig } from '@/lib/integrations/google/config'

/**
 * GET — Google Calendar status for the active workspace: whether the
 * platform has an OAuth client, every staff connection (status fields
 * only, never tokens) and the staff row linked to the current user.
 */
export async function GET() {
  const guard = await requireWorkspace()
  if (!guard.ok) return guard.response
  const { user, workspace, role } = guard.ctx
  const db = supabaseAdmin()
  const [cfg, conns, mine] = await Promise.all([
    getGoogleConfig(),
    db
      .from('calendar_connections')
      .select('id, staff_id, google_email, status, last_error, last_synced_at, watch_expires_at, created_at')
      .eq('workspace_id', workspace.id),
    db.from('staff').select('id, name').eq('workspace_id', workspace.id).eq('member_user_id', user.id).limit(1).maybeSingle(),
  ])
  const pending = await db
    .from('bookings')
    .select('staff_id', { count: 'exact', head: false })
    .eq('workspace_id', workspace.id)
    .eq('google_sync_state', 'error')
    .limit(200)
  const errorsByStaff: Record<string, number> = {}
  for (const r of pending.data ?? []) if (r.staff_id) errorsByStaff[r.staff_id] = (errorsByStaff[r.staff_id] ?? 0) + 1

  return NextResponse.json({
    configured: !!cfg,
    can_manage_all: hasRole(role, 'admin'),
    my_staff: mine.data ?? null,
    connections: (conns.data ?? []).map((c) => ({ ...c, sync_errors: errorsByStaff[c.staff_id] ?? 0 })),
  })
}

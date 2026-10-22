import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'
import { getGoogleConfig } from '@/lib/integrations/google/config'
import { canManageStaffCalendar } from '@/lib/integrations/google/connect'
import { buildAuthUrl } from '@/lib/integrations/google/oauth'
import { signState, stateSecret } from '@/lib/integrations/google/state'

/**
 * GET ?staff_id=…[&return=profile] — starts Google consent for that staff
 * member's calendar. Admins: any staff; members: the staff row linked to
 * them (staff.member_user_id).
 */
export async function GET(request: Request) {
  const guard = await requireWorkspace()
  if (!guard.ok) return guard.response
  const { user, workspace, role } = guard.ctx
  const url = new URL(request.url)
  const staffId = url.searchParams.get('staff_id')
  if (!isUuid(staffId)) return NextResponse.json({ error: 'staff_id is required' }, { status: 400 })

  const allowed = await canManageStaffCalendar(workspace.id, staffId, { id: user.id, role })
  if (!allowed.ok) return NextResponse.json({ error: allowed.status === 404 ? 'Not found' : 'Forbidden' }, { status: allowed.status })

  const cfg = await getGoogleConfig()
  if (!cfg) return NextResponse.json({ error: 'Google Calendar is not configured on this platform' }, { status: 503 })

  const state = signState(
    { w: workspace.id, s: staffId, u: user.id, r: returnOf(url.searchParams.get('return')) },
    stateSecret(),
  )
  return NextResponse.redirect(buildAuthUrl(cfg, state, user.email), { status: 302 })
}

/** Page to come back to after Google (Settings → Profile / Integrations, else the staff page). */
function returnOf(v: string | null): 'staff' | 'profile' | 'integrations' {
  return v === 'profile' || v === 'integrations' ? v : 'staff'
}

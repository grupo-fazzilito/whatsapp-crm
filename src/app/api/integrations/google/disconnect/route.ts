import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'
import { canManageStaffCalendar, getConnectionForStaff } from '@/lib/integrations/google/connect'
import { disconnectConnection } from '@/lib/integrations/google/sync'

/** POST {staff_id} — stops the push channel, revokes the grant, deletes the connection. */
export async function POST(request: Request) {
  const guard = await requireWorkspace()
  if (!guard.ok) return guard.response
  const { user, workspace, role } = guard.ctx
  const body = await request.json().catch(() => ({}))
  const staffId = body.staff_id
  if (!isUuid(staffId)) return NextResponse.json({ error: 'staff_id is required' }, { status: 400 })
  const allowed = await canManageStaffCalendar(workspace.id, staffId, { id: user.id, role })
  if (!allowed.ok) return NextResponse.json({ error: allowed.status === 404 ? 'Not found' : 'Forbidden' }, { status: allowed.status })
  const conn = await getConnectionForStaff(workspace.id, staffId)
  if (!conn) return NextResponse.json({ ok: true })
  await disconnectConnection(conn)
  return NextResponse.json({ ok: true })
}

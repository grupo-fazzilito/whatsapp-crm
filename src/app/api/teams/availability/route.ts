import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'

/**
 * GET   /api/teams/availability → { available }
 * PATCH /api/teams/availability { available: boolean } → { available }
 * The caller's own "Disponible" switch: only available members receive
 * auto-assigned and round-robin transferred conversations.
 */
export async function GET() {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { db, user, workspace } = guard.ctx
  const data = await db.workspace_members.findFirst({ select: { available: true }, where: { workspace_id: workspace.id, user_id: user.id } })
  return NextResponse.json({ available: data?.available !== false })
}

export async function PATCH(request: Request) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { db, user, workspace } = guard.ctx
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (typeof body?.available !== 'boolean') {
    return NextResponse.json({ error: 'available must be a boolean' }, { status: 400 })
  }
  // Same as the SQL function set_my_availability (which reads the user from
  // app_user_id(), not set on this connection): the caller's active membership.
  let data: boolean | null
  try {
    const rows = await db.workspace_members.updateManyAndReturn({
      where: { workspace_id: workspace.id, user_id: user.id, status: 'active' },
      data: { available: body.available, updated_at: new Date().toISOString() },
      select: { available: true },
    })
    data = rows[0]?.available ?? null
  } catch (error) {
    console.error('[availability] update failed:', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'Failed to update availability' }, { status: 500 })
  }
  return NextResponse.json({ available: data !== false })
}

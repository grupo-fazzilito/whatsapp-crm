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
  const { supabase, user, workspace } = guard.ctx
  const { data } = await supabase
    .from('workspace_members')
    .select('available')
    .eq('workspace_id', workspace.id)
    .eq('user_id', user.id)
    .maybeSingle()
  return NextResponse.json({ available: data?.available !== false })
}

export async function PATCH(request: Request) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { supabase, workspace } = guard.ctx
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (typeof body?.available !== 'boolean') {
    return NextResponse.json({ error: 'available must be a boolean' }, { status: 400 })
  }
  const { data, error } = await supabase.rpc('set_my_availability', { ws: workspace.id, is_available: body.available })
  if (error) {
    console.error('[availability] update failed:', error.message)
    return NextResponse.json({ error: 'Failed to update availability' }, { status: 500 })
  }
  return NextResponse.json({ available: data !== false })
}

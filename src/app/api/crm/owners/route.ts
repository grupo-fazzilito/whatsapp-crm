import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { memberProfiles } from '@/lib/crm/server'

/**
 * GET /api/crm/owners — any member. Profiles of the workspace's active
 * members (deals.assigned_to → profiles.id), by name. → { profiles }
 */
export async function GET() {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  try {
    return NextResponse.json({ profiles: await memberProfiles(guard.ctx.db) })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}

import 'server-only'
import { NextResponse } from 'next/server'
import { requireWorkspace, type WorkspaceContext } from '@/lib/workspace/context'
import { ImportBusyError } from '@/lib/real-estate/portals/sync'

/** Portal imports: workspace admins of real-estate workspaces only. */
export async function requirePortalsAdmin(): Promise<{ ok: true; ctx: WorkspaceContext } | { ok: false; response: NextResponse }> {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard
  if (guard.ctx.workspace.industry !== 'real_estate') {
    return { ok: false, response: NextResponse.json({ error: 'industry' }, { status: 403 }) }
  }
  return guard
}

export function busyOr500(e: unknown, tag: string) {
  if (e instanceof ImportBusyError) return NextResponse.json({ error: 'busy' }, { status: 409 })
  console.error(`[portals] ${tag}`, e)
  return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 })
}

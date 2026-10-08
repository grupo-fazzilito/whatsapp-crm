import { NextResponse } from 'next/server'
import { deleteMlConnection, getMlConnection, markMlConnection } from '@/lib/real-estate/portals/mercadolibre/connection'
import { requirePortalsAdmin } from '../_lib/guard'

/**
 * PATCH  /api/real-estate/portals/mercadolibre { auto_import: boolean }
 * DELETE /api/real-estate/portals/mercadolibre — forgets the tokens. Imported
 * listings stay in the catalog (they are the agency's data).
 */
export async function PATCH(request: Request) {
  const guard = await requirePortalsAdmin()
  if (!guard.ok) return guard.response
  const body = (await request.json().catch(() => null)) as { auto_import?: unknown } | null
  if (typeof body?.auto_import !== 'boolean') return NextResponse.json({ error: 'auto_import must be boolean' }, { status: 400 })
  const conn = await getMlConnection(guard.ctx.workspace.id)
  if (!conn) return NextResponse.json({ error: 'not_connected' }, { status: 404 })
  await markMlConnection(conn.id, { auto_import: body.auto_import })
  return NextResponse.json({ ok: true })
}

export async function DELETE() {
  const guard = await requirePortalsAdmin()
  if (!guard.ok) return guard.response
  await deleteMlConnection(guard.ctx.workspace.id)
  return NextResponse.json({ ok: true })
}

import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { catalogStatus } from '@/lib/meta-catalog/connection'
import { queueAllProducts, syncWorkspaceCatalog } from '@/lib/meta-catalog/sync'

/** POST (admin) → sends every product again ("Sincronizar ahora"); returns the status. */
export async function POST() {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const ws = guard.ctx.workspace
  const conn = await guard.ctx.db.meta_catalogs.findFirst({ where: { workspace_id: ws.id }, select: { workspace_id: true } })
  if (!conn) return NextResponse.json({ error: 'not_connected' }, { status: 409 })
  await queueAllProducts(ws.id)
  const result = await syncWorkspaceCatalog(ws.id)
  return NextResponse.json({ result, ...(await catalogStatus(ws)) })
}

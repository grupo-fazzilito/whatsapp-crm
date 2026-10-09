import { NextResponse } from 'next/server'
import type { Prisma } from '@/generated/prisma/client'
import { isUuid } from '@/lib/workspace/constants'
import { productAttributesFor } from '@/lib/catalog/attributes'
import { sanitizeMapping } from '@/lib/real-estate/portals/feed/mapping'
import { requirePortalsAdmin } from '../../_lib/guard'
import { parseFeedInput } from '../../_lib/input'

/**
 * PATCH  /api/real-estate/portals/feeds/[id] { name?, url?, portal?, format?, item_path?, mapping?, schedule?, deactivate_missing? }
 * DELETE /api/real-estate/portals/feeds/[id] — imported products stay in the catalog.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePortalsAdmin()
  if (!guard.ok) return guard.response
  const ws = guard.ctx.workspace
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  const parsed = parseFeedInput(body, true)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const patch: Record<string, unknown> = { ...parsed.value }
  if ('mapping' in body) {
    const mapping = sanitizeMapping(body.mapping, productAttributesFor(ws.industry, ws.settings))
    if (!Object.values(mapping).includes('external_id')) return NextResponse.json({ error: 'mapping_external_id' }, { status: 400 })
    patch.mapping = mapping
  }
  if (!Object.keys(patch).length) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  const db = guard.ctx.db
  let data
  try {
    const rows = await db.portal_feeds.updateManyAndReturn({ where: { id }, data: patch as Prisma.portal_feedsUpdateManyMutationInput })
    data = rows[0] ?? null
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ feed: data })
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePortalsAdmin()
  if (!guard.ok) return guard.response
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  try {
    await guard.ctx.db.portal_feeds.deleteMany({ where: { id } })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}

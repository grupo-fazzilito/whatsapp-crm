import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
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
  const { data, error } = await supabaseAdmin().from('portal_feeds').update(patch).eq('workspace_id', ws.id).eq('id', id).select('*').maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ feed: data })
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePortalsAdmin()
  if (!guard.ok) return guard.response
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  const { error } = await supabaseAdmin().from('portal_feeds').delete().eq('workspace_id', guard.ctx.workspace.id).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

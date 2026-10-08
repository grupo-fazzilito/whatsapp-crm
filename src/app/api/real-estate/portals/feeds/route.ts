import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { productAttributesFor } from '@/lib/catalog/attributes'
import { sanitizeMapping } from '@/lib/real-estate/portals/feed/mapping'
import { requirePortalsAdmin } from '../_lib/guard'
import { parseFeedInput } from '../_lib/input'

const MAX_FEEDS = 20

/**
 * POST /api/real-estate/portals/feeds
 *   { name, url, portal?, format?, item_path?, mapping, schedule?, deactivate_missing? } → feed
 * The mapping must include an external id (that is how re-imports match).
 */
export async function POST(request: Request) {
  const guard = await requirePortalsAdmin()
  if (!guard.ok) return guard.response
  const ws = guard.ctx.workspace
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  const parsed = parseFeedInput(body, false)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const mapping = sanitizeMapping(body.mapping, productAttributesFor(ws.industry, ws.settings))
  if (!Object.values(mapping).includes('external_id')) return NextResponse.json({ error: 'mapping_external_id' }, { status: 400 })

  const db = supabaseAdmin()
  const { count } = await db.from('portal_feeds').select('id', { count: 'exact', head: true }).eq('workspace_id', ws.id)
  if ((count ?? 0) >= MAX_FEEDS) return NextResponse.json({ error: 'too_many_feeds' }, { status: 400 })

  const { data, error } = await db
    .from('portal_feeds')
    .insert({ ...parsed.value, mapping, workspace_id: ws.id, created_by: guard.ctx.user.id })
    .select('*')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ feed: data }, { status: 201 })
}

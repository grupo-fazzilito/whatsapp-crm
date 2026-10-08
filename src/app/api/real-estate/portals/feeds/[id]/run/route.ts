import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { isUuid } from '@/lib/workspace/constants'
import { importFeed, type FeedRow } from '@/lib/real-estate/portals/feed/import'
import { busyOr500, requirePortalsAdmin } from '../../../_lib/guard'

export const maxDuration = 300

/** POST /api/real-estate/portals/feeds/[id]/run → { runId, summary, error? } */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePortalsAdmin()
  if (!guard.ok) return guard.response
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  const { data: feed } = await supabaseAdmin().from('portal_feeds').select('*').eq('workspace_id', guard.ctx.workspace.id).eq('id', id).maybeSingle()
  if (!feed) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  try {
    const result = await importFeed(feed as FeedRow, { trigger: 'manual', userId: guard.ctx.user.id })
    return NextResponse.json(result, { status: result.error ? 502 : 200 })
  } catch (e) {
    return busyOr500(e, 'feed run')
  }
}

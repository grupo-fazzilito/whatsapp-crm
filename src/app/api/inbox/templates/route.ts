import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'
import { approvedTemplates } from '@/lib/inbox/queries'

/** GET /api/inbox/templates[?channel_id=<uuid>] → { templates } Approved only; with channel_id: that channel's + channel-less. */
export async function GET(request: Request) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const channelId = new URL(request.url).searchParams.get('channel_id')
  if (channelId && !isUuid(channelId)) return NextResponse.json({ error: 'Invalid channel_id' }, { status: 400 })
  try {
    return NextResponse.json({ templates: await approvedTemplates(guard.ctx.db, channelId || null) })
  } catch (err) {
    console.error('[inbox] templates failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Failed to load templates' }, { status: 500 })
  }
}

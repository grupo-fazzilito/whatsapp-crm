import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'
import { audienceCount } from '@/lib/messenger-marketing/server'

/** POST { tag_ids } → { ready, too_soon } subscribers who'd get the message now. */
export async function POST(request: Request) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const body = (await request.json().catch(() => null)) as { tag_ids?: unknown } | null
  const tagIds = Array.isArray(body?.tag_ids) ? body.tag_ids.filter((x): x is string => typeof x === 'string' && isUuid(x)).slice(0, 100) : []
  return NextResponse.json(await audienceCount(guard.ctx.workspace.id, { tagIds }))
}

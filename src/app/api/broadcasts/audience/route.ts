import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { estimateAudience, parseAudience } from '@/lib/broadcasts/audience'

/**
 * POST /api/broadcasts/audience { audience: AudienceConfig } → { count: number | null }
 * Estimated reach of a broadcast audience (null while it's only partially set). Any member.
 */
export async function POST(request: Request) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const body = (await request.json().catch(() => null)) as { audience?: unknown } | null
  const parsed = parseAudience(body?.audience)
  if (!parsed.ok) return NextResponse.json({ count: null })
  try {
    return NextResponse.json({ count: await estimateAudience(guard.ctx.db, parsed.value) })
  } catch (err) {
    console.error('[broadcasts] audience estimate failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Failed to estimate audience' }, { status: 500 })
  }
}

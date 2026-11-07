import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { importSubscribers } from '@/lib/messenger-marketing/server'

/** POST (admins) → brings the subscribers Meta already has for the page. */
export async function POST() {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const rl = checkRateLimit(`mm-import:${guard.ctx.workspace.id}`, { limit: 5, windowMs: 10 * 60_000 })
  if (!rl.success) return rateLimitResponse(rl)
  try {
    return NextResponse.json(await importSubscribers(guard.ctx.workspace.id))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg === 'not_connected' ? 'not_connected' : 'failed', message: msg.slice(0, 200) }, { status: msg === 'not_connected' ? 409 : 502 })
  }
}

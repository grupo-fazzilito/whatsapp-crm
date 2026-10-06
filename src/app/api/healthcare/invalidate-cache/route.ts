import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { invalidateBusinessContext } from '@/lib/ai/context'

/**
 * POST — drop the cached business context of the active workspace so the
 * AI agents see business-setup changes (hours, staff, services, FAQs)
 * immediately instead of after the 1-minute cache TTL.
 */
export async function POST() {
  const guard = await requireWorkspace()
  if (!guard.ok) return guard.response
  invalidateBusinessContext(guard.ctx.workspace.id)
  return NextResponse.json({ success: true })
}

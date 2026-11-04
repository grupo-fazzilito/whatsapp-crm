import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { waitlistSummary } from '@/lib/waitlist/server'

/** GET /api/waitlist/summary → { products: { [id]: { waiting, ready } }, readyProducts, readyPeople } */
export async function GET() {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  return NextResponse.json(await waitlistSummary(guard.ctx.workspace.id))
}

import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { liveCalls } from '@/lib/calls/server'

/** GET /api/calls — WhatsApp calls ringing or in progress (an inbox opened mid-ring picks them up). */
export async function GET() {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  return NextResponse.json({ calls: await liveCalls(guard.ctx.workspace.id) })
}

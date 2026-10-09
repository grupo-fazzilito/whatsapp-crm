import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { loadSetup } from '@/lib/dashboard/kpis'

/** GET → { steps: { account, business, agent, training, test, channel, assign } } — getting-started checklist. */
export async function GET() {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  return NextResponse.json({ steps: await loadSetup(guard.ctx.workspace.id) })
}

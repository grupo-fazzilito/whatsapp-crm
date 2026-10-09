import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { creditBalance } from '@/lib/billing/credits'
import { actionCost } from '@/lib/billing/pricing'
import { getBillingSettings } from '@/lib/billing/settings'

/** GET /api/billing/status (any member) → { balance, low, depleted } for the app banner. */
export async function GET() {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const [balance, settings] = await Promise.all([creditBalance(guard.ctx.workspace.id), getBillingSettings()])
  return NextResponse.json({
    balance,
    enforce: settings.enforce,
    low: balance <= settings.low_credit_threshold,
    depleted: balance < actionCost('reply', settings),
  })
}

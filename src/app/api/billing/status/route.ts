import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { creditBalance } from '@/lib/billing/credits'
import { actionCost } from '@/lib/billing/pricing'
import { getBillingSettings } from '@/lib/billing/settings'

/** GET /api/billing/status (any member) → balance, next expiry, low/depleted flags (banner + dashboard card). */
export async function GET() {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const ws = guard.ctx.workspace.id
  const [balance, settings, next] = await Promise.all([
    creditBalance(ws),
    getBillingSettings(),
    guard.ctx.db.credit_lots
      .findFirst({ where: { credits_remaining: { gt: 0 }, expires_at: { gt: new Date() } }, select: { credits_remaining: true, expires_at: true }, orderBy: { expires_at: 'asc' } })
      .then((data) => ({ data }), () => ({ data: null })),
  ])
  return NextResponse.json({
    balance,
    reply_cost: actionCost('reply', settings),
    next_expiry: next.data ? { at: next.data.expires_at, credits: next.data.credits_remaining } : null,
    enforce: settings.enforce,
    low: balance <= settings.low_credit_threshold,
    depleted: balance < actionCost('reply', settings),
  })
}

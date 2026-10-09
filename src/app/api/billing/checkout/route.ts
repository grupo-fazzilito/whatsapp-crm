import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { createCheckout } from '@/lib/billing/payments'

const STATUS: Record<string, number> = {
  invalid_amount: 400,
  below_minimum: 400,
  too_large: 400,
  billing_profile_incomplete: 409,
  gateway_not_configured: 503,
  gateway_error: 502,
}

/** POST /api/billing/checkout { amount } (admins) → { payment } with the Payment Latam checkout_url. */
export async function POST(request: Request) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const body = (await request.json().catch(() => null)) as { amount?: unknown } | null
  if (!body) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })

  // At most 5 open checkout links per hour per workspace.
  const hourAgo = new Date(Date.now() - 3_600_000)
  const count = await guard.ctx.db.billing_payments
    .count({ where: { status: { in: ['creating', 'pending', 'failed'] }, created_at: { gte: hourAgo } } })
    .catch(() => null)
  if ((count ?? 0) >= 5) return NextResponse.json({ error: 'too_many_checkouts' }, { status: 429 })

  const r = await createCheckout({ workspaceId: guard.ctx.workspace.id, userId: guard.ctx.user.id, amount: body.amount })
  if (!r.ok) return NextResponse.json({ error: r.error, detail: r.detail ?? null }, { status: STATUS[r.error] ?? 400 })
  return NextResponse.json({ payment: r.payment })
}

import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { subscribe } from '@/lib/billing/subscriptions'

const STATUS: Record<string, number> = {
  invalid_tokens: 400,
  gateway_not_configured: 503,
  gateway_error: 502,
  payment_failed: 402,
  not_subscribed: 409,
  already_subscribed: 409,
}

/**
 * POST /api/billing/subscription { tokens } (admins) → { url } to Stripe Checkout
 * for a first subscription, or { subscription } after changing the plan.
 */
export async function POST(request: Request) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const body = (await request.json().catch(() => null)) as { tokens?: unknown } | null
  if (!body) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  const r = await subscribe({ workspaceId: guard.ctx.workspace.id, userId: guard.ctx.user.id, tokens: body.tokens })
  if (!r.ok) return NextResponse.json({ error: r.error, detail: r.detail ?? null }, { status: STATUS[r.error] ?? 400 })
  return NextResponse.json({ url: r.url ?? null, subscription: r.subscription ?? null })
}

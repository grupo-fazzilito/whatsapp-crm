import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { setCulqiCancel, subscribeCulqi, updateCulqiCard } from '@/lib/billing/culqi-subscriptions'
import { checkRateLimit } from '@/lib/rate-limit'

const STATUS: Record<string, number> = {
  gateway_not_configured: 503,
  already_subscribed: 409,
  billing_profile_incomplete: 400,
  invalid_limit: 400,
  invalid_token: 400,
  payment_failed: 402,
  gateway_error: 502,
  not_subscribed: 409,
}

/**
 * POST /api/billing/culqi (admins) — the credit plan with Culqi (Peru, soles):
 *   { action: 'subscribe', token_id, overage_limit? }  save the card, charge the first month
 *   { action: 'card', token_id }                       replace the card (retries a failed renewal)
 *   { action: 'cancel' | 'resume' }                    end at the month's end, or undo it
 * token_id comes from Culqi Checkout in the browser; card data never reaches us.
 */
export async function POST(request: Request) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const ws = guard.ctx.workspace.id
  const body = (await request.json().catch(() => null)) as { action?: string; token_id?: unknown; overage_limit?: unknown } | null
  if (!body) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })

  if (body.action === 'subscribe' || body.action === 'card') {
    // Card attempts are charges: keep them few.
    const limited = checkRateLimit(`culqi:${ws}`, { limit: 10, windowMs: 10 * 60_000 })
    if (!limited.success) return NextResponse.json({ error: 'too_many_attempts' }, { status: 429 })
  }

  const r =
    body.action === 'subscribe'
      ? await subscribeCulqi({ workspaceId: ws, tokenId: body.token_id, overageLimit: body.overage_limit })
      : body.action === 'card'
        ? await updateCulqiCard(ws, body.token_id)
        : body.action === 'cancel' || body.action === 'resume'
          ? await setCulqiCancel(ws, body.action === 'cancel')
          : null
  if (!r) return NextResponse.json({ error: 'invalid_action' }, { status: 400 })
  if (!r.ok) return NextResponse.json({ error: r.error, detail: r.detail ?? null }, { status: STATUS[r.error] ?? 400 })
  return NextResponse.json({ ok: true })
}

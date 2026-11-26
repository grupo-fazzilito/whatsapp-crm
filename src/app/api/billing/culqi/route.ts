import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { setCulqiCancel, subscribeCulqi, updateCulqiCard } from '@/lib/billing/culqi-subscriptions'
import { checkRateLimit } from '@/lib/rate-limit'
import { parse3DS, parseDeviceId } from '@/lib/billing/culqi'

const STATUS: Record<string, number> = {
  gateway_not_configured: 503,
  already_subscribed: 409,
  billing_profile_incomplete: 400,
  invalid_limit: 400,
  invalid_token: 400,
  payment_failed: 402,
  gateway_error: 502,
  not_subscribed: 409,
  needs_3ds: 402,
}

/**
 * POST /api/billing/culqi (admins) — the credit plan with Culqi (Peru, soles):
 *   { action: 'subscribe', token_id, overage_limit? }  charge the first month, save the card
 *   { action: 'card', token_id }                       replace the card (pays a failed renewal)
 *   both take device_id (Culqi3DS.generateDevice) and, when the answer was
 *   { error: 'needs_3ds', amount_cents }, are sent again with authentication_3ds
 *   (Culqi3DS's parameters3DS for that token).
 *   { action: 'cancel' | 'resume' }                    end at the month's end, or undo it
 * token_id comes from Culqi Checkout in the browser; card data never reaches us.
 */
export async function POST(request: Request) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const ws = guard.ctx.workspace.id
  const body = (await request.json().catch(() => null)) as { action?: string; token_id?: unknown; overage_limit?: unknown; device_id?: unknown; authentication_3ds?: unknown } | null
  if (!body) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })

  if (body.action === 'subscribe' || body.action === 'card') {
    // Card attempts are charges: keep them few.
    const limited = checkRateLimit(`culqi:${ws}`, { limit: 10, windowMs: 10 * 60_000 })
    if (!limited.success) return NextResponse.json({ error: 'too_many_attempts' }, { status: 429 })
  }

  const present = { deviceId: parseDeviceId(body.device_id), authentication3DS: parse3DS(body.authentication_3ds) }
  if (body.authentication_3ds != null && !present.authentication3DS) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  const r =
    body.action === 'subscribe'
      ? await subscribeCulqi({ workspaceId: ws, tokenId: body.token_id, overageLimit: body.overage_limit, ...present })
      : body.action === 'card'
        ? await updateCulqiCard(ws, body.token_id, new Date(), present)
        : body.action === 'cancel' || body.action === 'resume'
          ? await setCulqiCancel(ws, body.action === 'cancel')
          : null
  if (!r) return NextResponse.json({ error: 'invalid_action' }, { status: 400 })
  if (!r.ok) return NextResponse.json({ error: r.error, detail: r.detail ?? null, amount_cents: r.amountCents ?? null }, { status: STATUS[r.error] ?? 400 })
  return NextResponse.json({ ok: true })
}

import { NextResponse } from 'next/server'
import { handleStripeEvent } from '@/lib/billing/payments'
import { parseStripeEvent, stripeConfig, verifyStripeSignature } from '@/lib/billing/stripe'

/**
 * POST /api/billing/stripe/webhook — Stripe events for token top-ups
 * (checkout.session.completed / async_payment_succeeded / expired,
 * charge.refunded). Signed with STRIPE_WEBHOOK_SECRET; the payment is then
 * read back from Stripe's API before any credit is granted.
 */
export async function POST(request: Request) {
  const cfg = stripeConfig()
  if (!cfg?.webhookSecret) return NextResponse.json({ error: 'Stripe is not configured' }, { status: 503 })
  const raw = await request.text()
  if (!verifyStripeSignature(raw, request.headers.get('stripe-signature'), cfg.webhookSecret)) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 400 })
  }
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 })
  }
  const event = parseStripeEvent(body)
  if (!event) return NextResponse.json({ received: true })
  try {
    await handleStripeEvent(event)
  } catch (err) {
    // 500 → Stripe retries later.
    console.error('[billing] stripe webhook failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'failed' }, { status: 500 })
  }
  return NextResponse.json({ received: true })
}

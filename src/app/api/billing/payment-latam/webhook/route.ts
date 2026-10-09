import { NextResponse } from 'next/server'
import { handlePayinWebhook } from '@/lib/billing/payments'

/**
 * POST /api/billing/payment-latam/webhook?p=<payment id>&s=<token>
 * Payin notifications from Payment Latam. They are not signed, so the
 * URL carries a per-payment HMAC token and the order is re-checked with
 * consulta-recaudo before any credit is granted.
 */
export async function POST(request: Request) {
  const url = new URL(request.url)
  const body = await request.json().catch(() => null)
  try {
    const r = await handlePayinWebhook(url.searchParams.get('p'), url.searchParams.get('s'), body)
    if (r === 'unauthorized') return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[billing] webhook failed:', err instanceof Error ? err.message : err)
    // 500 → Payment Latam may retry; the cron re-checks pending orders anyway.
    return NextResponse.json({ error: 'failed' }, { status: 500 })
  }
}

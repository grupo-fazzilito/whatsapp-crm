import { NextResponse } from 'next/server'
import { getCalendlyConfig } from '@/lib/integrations/calendly/config'
import { verifyWebhookSignature } from '@/lib/integrations/calendly/model'
import { handleWebhook } from '@/lib/integrations/calendly/sync'

/** POST — Calendly webhook (invitee.created / invitee.canceled), signed with the OAuth app's signing key. */
export async function POST(request: Request) {
  const raw = await request.text()
  const cfg = await getCalendlyConfig()
  if (!cfg?.webhookSigningKey || !verifyWebhookSignature(request.headers.get('calendly-webhook-signature'), raw, cfg.webhookSigningKey)) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 })
  }
  let body: Parameters<typeof handleWebhook>[0]
  try {
    body = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 })
  }
  try {
    const r = await handleWebhook(body)
    return NextResponse.json(r)
  } catch (err) {
    console.error('[calendly] webhook failed:', err instanceof Error ? err.message : err)
    // 5xx makes Calendly retry; the cron poll also catches up.
    return NextResponse.json({ error: 'failed' }, { status: 500 })
  }
}

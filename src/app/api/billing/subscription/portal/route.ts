import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { portalUrl } from '@/lib/billing/subscriptions'

/** POST /api/billing/subscription/portal (admins) → { url } of Stripe's portal (card, invoices, cancel). */
export async function POST() {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  try {
    const url = await portalUrl(guard.ctx.workspace.id, guard.ctx.workspace.locale === 'en' ? 'en' : 'es')
    if (!url) return NextResponse.json({ error: 'not_subscribed' }, { status: 409 })
    return NextResponse.json({ url })
  } catch (err) {
    console.error('[subscription] portal failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'gateway_error' }, { status: 502 })
  }
}

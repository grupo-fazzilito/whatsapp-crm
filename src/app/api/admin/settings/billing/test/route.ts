import { NextResponse } from 'next/server'
import { isPlatformAdmin } from '@/lib/admin/guard'
import { getPaymentLatamConfig } from '@/lib/billing/settings'
import { generateToken } from '@/lib/billing/payment-latam'

/** POST /api/admin/settings/billing/test — checks the Payment Latam credentials by generating a token. */
export async function POST() {
  if (!(await isPlatformAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const cfg = await getPaymentLatamConfig()
  if (!cfg) return NextResponse.json({ ok: false, error: 'not_configured' })
  try {
    await generateToken(cfg, true)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'failed' })
  }
}

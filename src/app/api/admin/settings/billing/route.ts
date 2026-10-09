import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth/session'
import { isPlatformAdmin } from '@/lib/admin/guard'
import { normalizeBilling, type BillingSettings } from '@/lib/billing/pricing'
import { getBillingSettings, maskedPaymentLatam, saveBillingSettings, updatePaymentLatam, validBaseUrl, type PaymentLatamUpdate } from '@/lib/billing/settings'
import type { AmountFormat } from '@/lib/billing/payment-latam'

// Platform admin: credit prices/rules + Payment Latam credentials (secrets write-only).

async function view() {
  return { billing: await getBillingSettings(), payment_latam: await maskedPaymentLatam() }
}

export async function GET() {
  if (!(await isPlatformAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json(await view())
}

const MERCHANT_RE = /^[A-Za-z0-9_-]{1,40}$/
const SECRET_RE = /^[\x21-\x7e]{1,200}$/

export async function PUT(req: Request) {
  if (!(await isPlatformAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = (await req.json().catch(() => null)) as { billing?: Partial<BillingSettings>; payment_latam?: Record<string, unknown> } | null
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  const user = await getSessionUser()

  if (body.billing && typeof body.billing === 'object') {
    const current = await getBillingSettings()
    await saveBillingSettings(normalizeBilling({ ...current, ...body.billing, action_costs: { ...current.action_costs, ...(body.billing.action_costs ?? {}) } }), user?.id ?? null)
  }

  const pl = body.payment_latam
  if (pl && typeof pl === 'object') {
    const update: PaymentLatamUpdate = {}
    const str = (k: string) => (k in pl ? (pl[k] === null || pl[k] === '' ? null : typeof pl[k] === 'string' ? (pl[k] as string).trim() : undefined) : undefined)
    const baseUrl = str('base_url')
    if (baseUrl !== undefined) {
      if (baseUrl !== null && !validBaseUrl(baseUrl)) return NextResponse.json({ error: 'base_url must be an https URL' }, { status: 400 })
      update.base_url = baseUrl
    }
    const merchant = str('merchant_code')
    if (merchant !== undefined) {
      if (merchant !== null && !MERCHANT_RE.test(merchant)) return NextResponse.json({ error: 'merchant_code looks invalid' }, { status: 400 })
      update.merchant_code = merchant
    }
    for (const k of ['secret_user', 'secret_pass'] as const) {
      const v = str(k)
      if (v === undefined) continue
      if (v !== null && !SECRET_RE.test(v)) return NextResponse.json({ error: `${k} looks invalid` }, { status: 400 })
      update[k] = v
    }
    if (['fixed2', 'fixed1', 'plain'].includes(pl.amount_format as string)) update.amount_format = pl.amount_format as AmountFormat
    await updatePaymentLatam(update, user?.id ?? null)
  }
  return NextResponse.json(await view())
}

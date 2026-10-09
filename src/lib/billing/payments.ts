import 'server-only'
import crypto from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { checkTopup } from './pricing'
import { getBillingSettings, getPaymentLatamConfig } from './settings'
import { createPayin, expiryDate, parsePayinWebhook, queryPayin, PaymentLatamError, type PayinResult } from './payment-latam'
import { notifyBilling } from './credits'

// Top-ups: a billing_payments row + a Payment Latam Payin order. Credits
// are granted only after the order is confirmed APROBADA by consulta-recaudo
// (webhooks are unsigned), with the amount checked against ours.

export interface BillingPayment {
  id: string
  workspace_id: string
  amount: number
  credits: number
  status: 'creating' | 'pending' | 'paid' | 'expired' | 'reversed' | 'failed'
  provider_order_id: string | null
  reference: string | null
  checkout_url: string | null
  expires_on: string | null
  paid_at: string | null
  error: string | null
  created_at: string
}

const PAYMENT_COLUMNS = 'id, workspace_id, amount, credits, status, provider_order_id, reference, checkout_url, expires_on, paid_at, error, created_at'

/** Days a checkout link stays payable. */
const LINK_DAYS = 2

function webhookKey(): Buffer {
  const secret = process.env.ENCRYPTION_KEY
  if (!secret) throw new Error('ENCRYPTION_KEY is not set')
  return crypto.createHash('sha256').update(`billing-webhook:${secret}`).digest()
}

/** Per-payment secret carried in the webhook URL (Payment Latam does not sign webhooks). */
export function webhookToken(paymentId: string): string {
  return crypto.createHmac('sha256', webhookKey()).update(paymentId).digest('base64url').slice(0, 32)
}

export function validWebhookToken(paymentId: string, token: string | null): boolean {
  if (!token) return false
  const a = Buffer.from(webhookToken(paymentId))
  const b = Buffer.from(token)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3001').replace(/\/+$/, '')
}

export function webhookUrl(paymentId: string): string {
  return `${siteUrl()}/api/billing/payment-latam/webhook?p=${paymentId}&s=${webhookToken(paymentId)}`
}

export type CheckoutError =
  | 'invalid_amount'
  | 'below_minimum'
  | 'too_large'
  | 'billing_profile_incomplete'
  | 'gateway_not_configured'
  | 'gateway_error'

export async function createCheckout(input: {
  workspaceId: string
  userId: string
  amount: unknown
}): Promise<{ ok: true; payment: BillingPayment } | { ok: false; error: CheckoutError; detail?: string }> {
  const settings = await getBillingSettings()
  const check = checkTopup(input.amount, settings)
  if (!check.ok) return { ok: false, error: check.error }
  if (check.credits <= 0) return { ok: false, error: 'invalid_amount' }

  const cfg = await getPaymentLatamConfig()
  if (!cfg) return { ok: false, error: 'gateway_not_configured' }

  const db = supabaseAdmin()
  const { data: account } = await db.from('billing_accounts').select('doc_type, doc_number, legal_name, email').eq('workspace_id', input.workspaceId).maybeSingle()
  if (!account?.doc_type || !account.doc_number || !account.legal_name || !account.email) return { ok: false, error: 'billing_profile_incomplete' }

  const expiresOn = expiryDate(LINK_DAYS)
  const { data: created, error } = await db
    .from('billing_payments')
    .insert({
      workspace_id: input.workspaceId,
      amount: check.amount,
      credits: check.credits,
      unit_price: settings.credit_price,
      status: 'creating',
      expires_on: expiresOn,
      payer: { doc_type: account.doc_type, doc_number: account.doc_number, name: account.legal_name, email: account.email },
      created_by: input.userId,
    })
    .select('id')
    .single()
  if (error || !created) throw new Error(`billing_payments insert: ${error?.message}`)

  try {
    const r = await createPayin(cfg, {
      docType: account.doc_type,
      document: account.doc_number,
      name: account.legal_name,
      email: account.email,
      amount: check.amount,
      expiresOn,
      webhookUrl: webhookUrl(created.id),
    })
    const { data: payment } = await db
      .from('billing_payments')
      .update({ status: 'pending', provider_order_id: r.ordenID, reference: r.referencia, checkout_url: r.checkout, raw: { created: r } })
      .eq('id', created.id)
      .select(PAYMENT_COLUMNS)
      .single()
    return { ok: true, payment: payment as BillingPayment }
  } catch (err) {
    const detail = err instanceof PaymentLatamError ? err.message : 'unexpected error'
    console.error('[billing] payin create failed:', err instanceof Error ? err.message : err)
    await db.from('billing_payments').update({ status: 'failed', error: detail.slice(0, 300) }).eq('id', created.id)
    return { ok: false, error: 'gateway_error', detail }
  }
}

/**
 * Re-checks a payment with Payment Latam and applies the result:
 * APROBADA → paid + credits, VENCIDA → expired. Idempotent.
 */
export async function syncPayment(paymentId: string): Promise<BillingPayment | null> {
  const db = supabaseAdmin()
  const { data: p } = await db.from('billing_payments').select(PAYMENT_COLUMNS).eq('id', paymentId).maybeSingle()
  if (!p) return null
  const payment = p as BillingPayment
  if (!payment.provider_order_id || !['pending', 'expired'].includes(payment.status)) return payment
  const cfg = await getPaymentLatamConfig()
  if (!cfg) return payment

  let r: PayinResult
  try {
    r = await queryPayin(cfg, payment.provider_order_id)
  } catch (err) {
    console.warn('[billing] payin query failed:', err instanceof Error ? err.message : err)
    return payment
  }
  if (r.ordenID !== payment.provider_order_id) return payment

  if (r.estado === 'APROBADA') {
    if (r.monto !== null && r.monto + 0.001 < Number(payment.amount)) {
      await db.from('billing_payments').update({ error: `monto ${r.monto} < ${payment.amount}`, raw: { last: r } }).eq('id', payment.id)
      console.error(`[billing] payment ${payment.id} approved for less than expected`)
      return payment
    }
    const settings = await getBillingSettings()
    const { data: applied, error } = await db.rpc('apply_billing_payment', { pay: payment.id, months: settings.expiry_months })
    if (error) throw new Error(`apply_billing_payment: ${error.message}`)
    if (applied) await notifyBilling(payment.workspace_id, 'paid', payment.credits)
  } else if (r.estado === 'VENCIDA' && payment.status === 'pending') {
    await db.from('billing_payments').update({ status: 'expired', raw: { last: r } }).eq('id', payment.id).eq('status', 'pending')
  }
  const { data: fresh } = await db.from('billing_payments').select(PAYMENT_COLUMNS).eq('id', payment.id).single()
  return fresh as BillingPayment
}

/** Payment Latam webhook: authenticated by the per-payment URL token, verified with the API. */
export async function handlePayinWebhook(paymentId: string | null, token: string | null, body: unknown): Promise<'ok' | 'unauthorized' | 'ignored'> {
  if (!paymentId || !/^[0-9a-f-]{36}$/i.test(paymentId) || !validWebhookToken(paymentId, token)) return 'unauthorized'
  const db = supabaseAdmin()
  const { data: payment } = await db.from('billing_payments').select('id, status, provider_order_id').eq('id', paymentId).maybeSingle()
  if (!payment) return 'ignored'
  const event = parsePayinWebhook(body)
  if (event && payment.provider_order_id && event.ordenID !== payment.provider_order_id) return 'ignored'

  if (event?.estado === 'EXTORNO') {
    // A reversal is never reported by consulta-recaudo; the URL token proves origin.
    const { data: removed } = await db.rpc('reverse_billing_payment', { pay: payment.id })
    console.warn(`[billing] payment ${payment.id} reversed, ${removed ?? 0} credits removed`)
    return 'ok'
  }
  await syncPayment(payment.id)
  return 'ok'
}

/** Cron: re-check pending orders (missed webhooks) and expire old credits. */
export async function runBillingCron(): Promise<{ checked: number; expiredLots: number }> {
  const db = supabaseAdmin()
  const since = new Date(Date.now() - 35 * 86_400_000).toISOString()
  const settled = new Date(Date.now() - 60_000).toISOString()
  const { data: pending } = await db
    .from('billing_payments')
    .select('id')
    .eq('status', 'pending')
    .gte('created_at', since)
    .lte('created_at', settled)
    .order('created_at')
    .limit(50)
  for (const p of pending ?? []) {
    try {
      await syncPayment(p.id)
    } catch (err) {
      console.error('[billing] sync failed:', err instanceof Error ? err.message : err)
    }
  }
  const { data: expired, error } = await db.rpc('expire_credit_lots')
  if (error) console.error('[billing] expire_credit_lots failed:', error.message)
  return { checked: pending?.length ?? 0, expiredLots: Number(expired ?? 0) }
}

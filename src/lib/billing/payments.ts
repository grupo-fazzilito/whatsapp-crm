import 'server-only'
import crypto from 'node:crypto'
import { prisma } from '@/lib/db/prisma'
import type { Prisma } from '@/generated/prisma/client'
import { tenantDb } from '@/lib/db/tenant'
import { normalizeRaw } from '@/lib/db/compat'
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

const PAYMENT_COLUMNS = {
  id: true,
  workspace_id: true,
  amount: true,
  credits: true,
  status: true,
  provider_order_id: true,
  reference: true,
  checkout_url: true,
  expires_on: true,
  paid_at: true,
  error: true,
  created_at: true,
} as const

/** JSON column value (PayinResult is plain JSON from the gateway). */
function json(v: unknown): Prisma.InputJsonValue {
  return v as Prisma.InputJsonValue
}

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

  const db = tenantDb(input.workspaceId)
  const account = await db.billing_accounts.findFirst({
    where: { workspace_id: input.workspaceId },
    select: { doc_type: true, doc_number: true, legal_name: true, email: true },
  })
  if (!account?.doc_type || !account.doc_number || !account.legal_name || !account.email) return { ok: false, error: 'billing_profile_incomplete' }

  const expiresOn = expiryDate(LINK_DAYS)
  let created: { id: string }
  try {
    created = await db.billing_payments.create({
      data: {
        workspace_id: input.workspaceId,
        amount: check.amount,
        credits: check.credits,
        unit_price: settings.credit_price,
        status: 'creating',
        expires_on: expiresOn,
        payer: { doc_type: account.doc_type, doc_number: account.doc_number, name: account.legal_name, email: account.email },
        created_by: input.userId,
      },
      select: { id: true },
    })
  } catch (err) {
    throw new Error(`billing_payments insert: ${err instanceof Error ? err.message : err}`)
  }

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
    const payment = await db.billing_payments
      .update({
        where: { id: created.id },
        data: { status: 'pending', provider_order_id: r.ordenID, reference: r.referencia, checkout_url: r.checkout, raw: json({ created: r }) },
        select: PAYMENT_COLUMNS,
      })
      .catch((e) => {
        console.error('[billing] payment update failed:', e instanceof Error ? e.message : e)
        return null
      })
    return { ok: true, payment: payment as BillingPayment }
  } catch (err) {
    const detail = err instanceof PaymentLatamError ? err.message : 'unexpected error'
    console.error('[billing] payin create failed:', err instanceof Error ? err.message : err)
    await db.billing_payments
      .updateMany({ where: { id: created.id }, data: { status: 'failed', error: detail.slice(0, 300) } })
      .catch((e) => console.error('[billing] mark failed:', e instanceof Error ? e.message : e))
    return { ok: false, error: 'gateway_error', detail }
  }
}

/**
 * Re-checks a payment with Payment Latam and applies the result:
 * APROBADA → paid + credits, VENCIDA → expired. Idempotent.
 */
export async function syncPayment(paymentId: string): Promise<BillingPayment | null> {
  // Platform client for the lookup: the webhook and the cron only know the payment id.
  const p = await prisma.billing_payments.findUnique({ where: { id: paymentId }, select: PAYMENT_COLUMNS }).catch((e) => {
    console.error('[billing] payment lookup failed:', e instanceof Error ? e.message : e)
    return null
  })
  if (!p) return null
  const payment = p as BillingPayment
  const db = tenantDb(payment.workspace_id)
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
      await db.billing_payments
        .updateMany({ where: { id: payment.id }, data: { error: `monto ${r.monto} < ${payment.amount}`, raw: json({ last: r }) } })
        .catch((e) => console.error('[billing] payment update failed:', e instanceof Error ? e.message : e))
      console.error(`[billing] payment ${payment.id} approved for less than expected`)
      return payment
    }
    const settings = await getBillingSettings()
    let applied: boolean | null
    try {
      const [row] = await prisma.$queryRaw<{ v: boolean | null }[]>`SELECT public.apply_billing_payment(${payment.id}::uuid, ${settings.expiry_months}::int) AS v`
      applied = row?.v ?? null
    } catch (err) {
      throw new Error(`apply_billing_payment: ${err instanceof Error ? err.message : err}`)
    }
    if (applied) await notifyBilling(payment.workspace_id, 'paid', payment.credits)
  } else if (r.estado === 'VENCIDA' && payment.status === 'pending') {
    await db.billing_payments
      .updateMany({ where: { id: payment.id, status: 'pending' }, data: { status: 'expired', raw: json({ last: r }) } })
      .catch((e) => console.error('[billing] payment update failed:', e instanceof Error ? e.message : e))
  }
  const fresh = await db.billing_payments.findFirst({ where: { id: payment.id }, select: PAYMENT_COLUMNS })
  return fresh as BillingPayment
}

/** Payment Latam webhook: authenticated by the per-payment URL token, verified with the API. */
export async function handlePayinWebhook(paymentId: string | null, token: string | null, body: unknown): Promise<'ok' | 'unauthorized' | 'ignored'> {
  if (!paymentId || !/^[0-9a-f-]{36}$/i.test(paymentId) || !validWebhookToken(paymentId, token)) return 'unauthorized'
  // Platform client: the payment id (URL token checked above) is all we know yet.
  const payment = await prisma.billing_payments
    .findUnique({ where: { id: paymentId }, select: { id: true, status: true, provider_order_id: true } })
    .catch((e) => {
      console.error('[billing] payment lookup failed:', e instanceof Error ? e.message : e)
      return null
    })
  if (!payment) return 'ignored'
  const event = parsePayinWebhook(body)
  if (event && payment.provider_order_id && event.ordenID !== payment.provider_order_id) return 'ignored'

  if (event?.estado === 'EXTORNO') {
    // A reversal is never reported by consulta-recaudo; the URL token proves origin.
    let removed: number | null = null
    try {
      const [row] = normalizeRaw(await prisma.$queryRaw<{ v: number | null }[]>`SELECT public.reverse_billing_payment(${payment.id}::uuid) AS v`)
      removed = row?.v ?? null
    } catch (err) {
      console.error('[billing] reverse_billing_payment failed:', err instanceof Error ? err.message : err)
    }
    console.warn(`[billing] payment ${payment.id} reversed, ${removed ?? 0} credits removed`)
    return 'ok'
  }
  await syncPayment(payment.id)
  return 'ok'
}

/** Cron: re-check pending orders (missed webhooks) and expire old credits. */
export async function runBillingCron(): Promise<{ checked: number; expiredLots: number }> {
  // Platform client: the cron walks every workspace's pending payments.
  const since = new Date(Date.now() - 35 * 86_400_000)
  const settled = new Date(Date.now() - 60_000)
  let pending: { id: string }[] = []
  try {
    pending = await prisma.billing_payments.findMany({
      where: { status: 'pending', created_at: { gte: since, lte: settled } },
      select: { id: true },
      orderBy: { created_at: 'asc' },
      take: 50,
    })
  } catch (err) {
    console.error('[billing] pending payments query failed:', err instanceof Error ? err.message : err)
  }
  for (const p of pending ?? []) {
    try {
      await syncPayment(p.id)
    } catch (err) {
      console.error('[billing] sync failed:', err instanceof Error ? err.message : err)
    }
  }
  let expired: number | null = null
  try {
    const [row] = normalizeRaw(await prisma.$queryRaw<{ v: number | null }[]>`SELECT public.expire_credit_lots() AS v`)
    expired = row?.v ?? null
  } catch (err) {
    console.error('[billing] expire_credit_lots failed:', err instanceof Error ? err.message : err)
  }
  return { checked: pending.length, expiredLots: Number(expired ?? 0) }
}

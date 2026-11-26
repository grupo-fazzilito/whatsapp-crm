import 'server-only'
import { closeStaleOverage, retryOverageBilling } from './overage'
import { enforceAccountLimits } from './accounts'
import crypto from 'node:crypto'
import { prisma } from '@/lib/db/prisma'
import type { Prisma } from '@/generated/prisma/client'
import { tenantDb } from '@/lib/db/tenant'
import { normalizeRaw } from '@/lib/db/compat'
import { checkTopup, pricingFor } from './pricing'
import { workspaceRegion } from '@/lib/regions-server'
import { REGION_INFO } from '@/lib/regions'
import { getBillingSettings, getPaymentLatamConfig } from './settings'
import { createPayin, expiryDate, parsePayinWebhook, queryPayin, PaymentLatamError, type PayinResult } from './payment-latam'
import { notifyBilling } from './credits'
import { createCheckoutSession, getCheckoutSession, parseStripeEvent, stripeConfig, StripeError, toCents, type StripeSession } from './stripe'

// Top-ups: a billing_payments row + a Payment Latam Payin order. Credits
// are granted only after the order is confirmed APROBADA by consulta-recaudo
// (webhooks are unsigned), with the amount checked against ours.

export interface BillingPayment {
  id: string
  workspace_id: string
  provider: string
  amount: number
  currency: string
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
  provider: true,
  amount: true,
  currency: true,
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
  const [settings, region] = await Promise.all([getBillingSettings(), workspaceRegion(input.workspaceId)])
  const prices = pricingFor(settings, region)
  const check = checkTopup(input.amount, prices)
  if (!check.ok) return { ok: false, error: check.error }
  if (check.credits <= 0) return { ok: false, error: 'invalid_amount' }

  // Each region pays through its own gateway: Peru Payment Latam, the US (and the rest) Stripe.
  const gateway = REGION_INFO[region].gateway
  if (gateway === 'stripe') return createStripeCheckout(input, prices.currency, check, prices.credit_price)
  if (gateway !== 'payment_latam') return { ok: false, error: 'gateway_not_configured' }
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
        unit_price: prices.credit_price,
        currency: prices.currency,
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
  if (payment.provider === 'stripe') return syncStripePayment(payment)
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
    await applyPaid(payment)
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
  // Extra credits of subscribers: months never closed, and invoice items to retry.
  try {
    await closeStaleOverage()
    await retryOverageBilling()
  } catch (err) {
    console.error('[billing] overage cron failed:', err instanceof Error ? err.message : err)
  }
  // Free plan: one account per service (30 days to subscribe, then the extra ones disconnect).
  try {
    await enforceAccountLimits()
  } catch (err) {
    console.error('[billing] account limits failed:', err instanceof Error ? err.message : err)
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

/** Marks a confirmed payment paid and grants its credits (once: the SQL function is idempotent). */
async function applyPaid(payment: BillingPayment): Promise<void> {
  const settings = await getBillingSettings()
  let applied: boolean | null
  try {
    const [row] = await prisma.$queryRaw<{ v: boolean | null }[]>`SELECT public.apply_billing_payment(${payment.id}::uuid, ${settings.expiry_months}::int) AS v`
    applied = row?.v ?? null
  } catch (err) {
    throw new Error(`apply_billing_payment: ${err instanceof Error ? err.message : err}`)
  }
  if (applied) await notifyBilling(payment.workspace_id, 'paid', payment.credits)
}

// ------------------------------------------------------------
// Stripe (US region)
// ------------------------------------------------------------

async function createStripeCheckout(
  input: { workspaceId: string; userId: string },
  currency: string,
  check: { amount: number; credits: number },
  unitPrice: number,
): Promise<{ ok: true; payment: BillingPayment } | { ok: false; error: CheckoutError; detail?: string }> {
  const cfg = stripeConfig()
  if (!cfg) return { ok: false, error: 'gateway_not_configured' }
  const db = tenantDb(input.workspaceId)
  // Stripe asks for the card details itself: only an email for the receipt (billing profile, else the admin's).
  const [account, profile, ws] = await Promise.all([
    db.billing_accounts.findFirst({ where: { workspace_id: input.workspaceId }, select: { legal_name: true, email: true } }),
    prisma.profiles.findUnique({ where: { user_id: input.userId }, select: { email: true } }),
    prisma.workspaces.findUnique({ where: { id: input.workspaceId }, select: { locale: true } }),
  ])
  const email = account?.email || profile?.email || null

  let created: { id: string }
  try {
    created = await db.billing_payments.create({
      data: {
        workspace_id: input.workspaceId,
        provider: 'stripe',
        amount: check.amount,
        currency,
        credits: check.credits,
        unit_price: unitPrice,
        status: 'creating',
        payer: { email, name: account?.legal_name ?? null },
        created_by: input.userId,
      },
      select: { id: true },
    })
  } catch (err) {
    throw new Error(`billing_payments insert: ${err instanceof Error ? err.message : err}`)
  }

  try {
    const locale = ws?.locale === 'en' ? 'en' : 'es'
    const back = `${siteUrl()}/settings?tab=billing`
    const session = await createCheckoutSession(cfg, {
      paymentId: created.id,
      amount: check.amount,
      currency,
      credits: check.credits,
      productName: locale === 'en' ? `Whasalia — ${check.credits.toLocaleString('en-US')} AI tokens` : `Whasalia — ${check.credits.toLocaleString('es-PE')} tokens de IA`,
      email,
      successUrl: `${back}&paid=${created.id}`,
      cancelUrl: back,
      locale,
    })
    const payment = await db.billing_payments
      .update({
        where: { id: created.id },
        data: {
          status: 'pending',
          provider_order_id: session.id,
          checkout_url: session.url,
          expires_on: session.expires_at ? new Date(session.expires_at * 1000) : null,
          raw: json({ created: { id: session.id, expires_at: session.expires_at } }),
        },
        select: PAYMENT_COLUMNS,
      })
      .catch((e) => {
        console.error('[billing] payment update failed:', e instanceof Error ? e.message : e)
        return null
      })
    return { ok: true, payment: payment as BillingPayment }
  } catch (err) {
    const detail = err instanceof StripeError ? err.message : 'unexpected error'
    console.error('[billing] stripe session failed:', err instanceof Error ? err.message : err)
    await db.billing_payments
      .updateMany({ where: { id: created.id }, data: { status: 'failed', error: detail.slice(0, 300) } })
      .catch((e) => console.error('[billing] mark failed:', e instanceof Error ? e.message : e))
    return { ok: false, error: 'gateway_error', detail }
  }
}

/** Reads the Checkout Session back from Stripe: paid (full amount, same currency) → credits; expired → expired. */
async function syncStripePayment(payment: BillingPayment): Promise<BillingPayment> {
  const cfg = stripeConfig()
  if (!cfg || !payment.provider_order_id) return payment
  const db = tenantDb(payment.workspace_id)
  let session: StripeSession
  try {
    session = await getCheckoutSession(cfg, payment.provider_order_id)
  } catch (err) {
    console.warn('[billing] stripe session lookup failed:', err instanceof Error ? err.message : err)
    return payment
  }
  if (session.client_reference_id !== payment.id) return payment

  if (session.payment_status === 'paid') {
    const expected = toCents(Number(payment.amount))
    if ((session.amount_total ?? 0) < expected || (session.currency ?? '').toUpperCase() !== (payment.currency || 'USD').toUpperCase()) {
      await db.billing_payments
        .updateMany({ where: { id: payment.id }, data: { error: `paid ${session.amount_total} ${session.currency} < ${expected}`, raw: json({ last: session }) } })
        .catch((e) => console.error('[billing] payment update failed:', e instanceof Error ? e.message : e))
      console.error(`[billing] stripe payment ${payment.id} paid less than expected`)
      return payment
    }
    // The payment intent identifies a later refund (charge.refunded).
    await db.billing_payments
      .updateMany({ where: { id: payment.id }, data: { reference: session.payment_intent, raw: json({ last: session }) } })
      .catch((e) => console.error('[billing] payment update failed:', e instanceof Error ? e.message : e))
    await applyPaid(payment)
  } else if (session.status === 'expired' && payment.status === 'pending') {
    await db.billing_payments
      .updateMany({ where: { id: payment.id, status: 'pending' }, data: { status: 'expired', raw: json({ last: session }) } })
      .catch((e) => console.error('[billing] payment update failed:', e instanceof Error ? e.message : e))
  }
  const fresh = await db.billing_payments.findFirst({ where: { id: payment.id }, select: PAYMENT_COLUMNS })
  return (fresh as BillingPayment) ?? payment
}

/** Stripe webhook (signature checked by the route): look the payment up again, or take back a refund's credits. */
export async function handleStripeEvent(event: NonNullable<ReturnType<typeof parseStripeEvent>>): Promise<'ok' | 'ignored'> {
  if (event.type === 'charge.refunded') {
    // Platform client: the event only carries Stripe's ids.
    const payment = await prisma.billing_payments
      .findFirst({
        where: { provider: 'stripe', OR: [...(event.paymentId && /^[0-9a-f-]{36}$/i.test(event.paymentId) ? [{ id: event.paymentId }] : []), ...(event.paymentIntent ? [{ reference: event.paymentIntent }] : [])] },
        select: { id: true },
      })
      .catch(() => null)
    if (!payment) return 'ignored'
    try {
      const [row] = normalizeRaw(await prisma.$queryRaw<{ v: number | null }[]>`SELECT public.reverse_billing_payment(${payment.id}::uuid) AS v`)
      console.warn(`[billing] stripe payment ${payment.id} refunded, ${row?.v ?? 0} credits removed`)
    } catch (err) {
      console.error('[billing] reverse_billing_payment failed:', err instanceof Error ? err.message : err)
    }
    return 'ok'
  }
  const id = event.paymentId
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return 'ignored'
  const p = await prisma.billing_payments.findUnique({ where: { id }, select: { provider: true, provider_order_id: true } }).catch(() => null)
  if (!p || p.provider !== 'stripe' || (event.sessionId && p.provider_order_id !== event.sessionId)) return 'ignored'
  await syncPayment(id)
  return 'ok'
}

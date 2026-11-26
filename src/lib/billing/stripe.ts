import crypto from 'node:crypto'

// Stripe Checkout for token top-ups (US region; the account belongs to Arepa
// Labs LLC). One-time payments: a Checkout Session in `payment` mode with the
// pack's amount. Credits are granted only after the session is read back from
// the API as paid (the webhook just says "look again").
//   POST /v1/checkout/sessions          create → { id, url, expires_at }
//   GET  /v1/checkout/sessions/{id}     → { status, payment_status, amount_total, currency, client_reference_id, payment_intent }
// Webhook: header Stripe-Signature "t=<unix>,v1=<hex HMAC-SHA256(secret, `${t}.${rawBody}`)>".
// Env: STRIPE_SECRET_KEY (sk_test_… / sk_live_…), STRIPE_WEBHOOK_SECRET (whsec_…).

const API = 'https://api.stripe.com/v1'

export interface StripeConfig {
  secretKey: string
  webhookSecret: string | null
}

export function stripeConfig(env: Record<string, string | undefined> = process.env): StripeConfig | null {
  const secretKey = env.STRIPE_SECRET_KEY?.trim()
  if (!secretKey || !/^(sk|rk)_(test|live)_/.test(secretKey)) return null
  return { secretKey, webhookSecret: env.STRIPE_WEBHOOK_SECRET?.trim() || null }
}

export class StripeError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'StripeError'
  }
}

/** Stripe's form encoding: nested keys as a[b][c]=v. */
export function formEncode(obj: Record<string, unknown>, prefix = ''): string[] {
  const out: string[] = []
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue
    const key = prefix ? `${prefix}[${k}]` : k
    if (Array.isArray(v)) v.forEach((item, i) => out.push(...(typeof item === 'object' ? formEncode(item as Record<string, unknown>, `${key}[${i}]`) : [`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(item))}`])))
    else if (typeof v === 'object') out.push(...formEncode(v as Record<string, unknown>, key))
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`)
  }
  return out
}

async function call<T>(cfg: StripeConfig, method: 'GET' | 'POST', path: string, body?: Record<string, unknown>, idempotencyKey?: string): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${cfg.secretKey}`,
      ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: body ? formEncode(body).join('&') : undefined,
    cache: 'no-store',
  })
  const data = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } }
  if (!res.ok) throw new StripeError(data.error?.message ?? `Stripe API error: ${res.status}`, res.status)
  return data
}

export interface StripeSession {
  id: string
  url: string | null
  status: 'open' | 'complete' | 'expired' | string
  payment_status: 'paid' | 'unpaid' | 'no_payment_required' | string
  amount_total: number | null
  currency: string | null
  client_reference_id: string | null
  payment_intent: string | null
  expires_at: number | null
}

/** Amount in the currency's smallest unit (cents for USD). */
export const toCents = (amount: number) => Math.round(amount * 100)

export function createCheckoutSession(
  cfg: StripeConfig,
  input: { paymentId: string; amount: number; currency: string; credits: number; productName: string; email: string | null; successUrl: string; cancelUrl: string; locale: 'es' | 'en' },
): Promise<StripeSession> {
  return call<StripeSession>(
    cfg,
    'POST',
    '/checkout/sessions',
    {
      mode: 'payment',
      client_reference_id: input.paymentId,
      customer_email: input.email ?? undefined,
      locale: input.locale,
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      line_items: [
        {
          quantity: 1,
          price_data: { currency: input.currency.toLowerCase(), unit_amount: toCents(input.amount), product_data: { name: input.productName } },
        },
      ],
      metadata: { payment_id: input.paymentId, credits: input.credits },
      payment_intent_data: { metadata: { payment_id: input.paymentId } },
    },
    // A retried request must not open a second session for the same payment.
    `whasalia-topup-${input.paymentId}`,
  )
}

export function getCheckoutSession(cfg: StripeConfig, id: string): Promise<StripeSession> {
  if (!/^cs_[A-Za-z0-9_]+$/.test(id)) throw new StripeError('Invalid session id')
  return call<StripeSession>(cfg, 'GET', `/checkout/sessions/${id}`)
}

/** Stripe-Signature check (any v1 may match during secret rotation); refuses deliveries older than `toleranceSec`. */
export function verifyStripeSignature(rawBody: string, header: string | null, secret: string, nowSec = Math.floor(Date.now() / 1000), toleranceSec = 300): boolean {
  if (!header || !secret) return false
  let t: number | null = null
  const sigs: string[] = []
  for (const part of header.split(',')) {
    const i = part.indexOf('=')
    const k = part.slice(0, i).trim()
    const v = part.slice(i + 1).trim()
    if (k === 't') t = Number(v)
    else if (k === 'v1' && /^[0-9a-f]+$/i.test(v)) sigs.push(v)
  }
  if (t === null || !Number.isFinite(t) || Math.abs(nowSec - t) > toleranceSec || sigs.length === 0) return false
  const expected = Buffer.from(crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex'), 'hex')
  return sigs.some((s) => {
    const got = Buffer.from(s, 'hex')
    return got.length === expected.length && crypto.timingSafeEqual(got, expected)
  })
}

/** What a webhook event says about a top-up, or null for events we don't use. */
export interface StripeEventRef {
  type: string
  sessionId: string | null
  paymentId: string | null
  paymentIntent: string | null
  subscriptionId?: string | null
  invoiceId?: string | null
  /** checkout.session.*: payment (top-up) or subscription. */
  mode?: string | null
}

export function parseStripeEvent(body: unknown): StripeEventRef | null {
  const b = (body ?? {}) as { type?: unknown; data?: { object?: Record<string, unknown> } }
  if (typeof b.type !== 'string') return null
  const o = b.data?.object ?? {}
  const str = (v: unknown) => (typeof v === 'string' && v ? v : null)
  if (b.type.startsWith('checkout.session.')) {
    return { type: b.type, sessionId: str(o.id), paymentId: str(o.client_reference_id), paymentIntent: str(o.payment_intent), mode: str(o.mode), subscriptionId: str(o.subscription) }
  }
  // Subscriptions: which one (or which invoice) to read back from the API.
  if (b.type.startsWith('customer.subscription.')) {
    return { type: b.type, sessionId: null, paymentId: null, paymentIntent: null, subscriptionId: str(o.id), invoiceId: null }
  }
  if (b.type === 'invoice.paid' || b.type === 'invoice.payment_failed' || b.type === 'invoice.created') {
    return { type: b.type, sessionId: null, paymentId: null, paymentIntent: null, subscriptionId: null, invoiceId: str(o.id) }
  }
  if (b.type === 'charge.refunded') {
    return { type: b.type, sessionId: null, paymentId: str((o.metadata as Record<string, unknown> | undefined)?.payment_id), paymentIntent: str(o.payment_intent) }
  }
  return null
}

// ------------------------------------------------------------
// Subscriptions (monthly AI tokens)
//   POST /v1/checkout/sessions (mode=subscription)   first subscription
//   GET  /v1/subscriptions/{id}                       status, period, item + price
//   POST /v1/subscriptions/{id}                       change the plan (item price)
//   GET  /v1/invoices/{id}                            a paid invoice, read back
//   POST /v1/billing_portal/sessions                  card, invoices, cancel
// ------------------------------------------------------------

export interface StripeSubscription {
  id: string
  customer: string
  status: string
  cancel_at_period_end: boolean
  current_period_end?: number | null
  metadata?: Record<string, string>
  items: { data: { id: string; current_period_end?: number | null; price: { id: string; product: string; unit_amount: number | null; currency: string } }[] }
}

export interface StripeInvoice {
  id: string
  status: string
  billing_reason: string | null
  amount_paid: number
  currency: string
  customer: string
  subscription?: string | null
  parent?: { subscription_details?: { subscription?: string | null; metadata?: Record<string, string> } | null } | null
  lines: { data: { period?: { start: number; end: number } }[] }
  hosted_invoice_url?: string | null
  period_start?: number
  period_end?: number
}

/** Period end of a subscription (newer API versions keep it on the item). */
export function subscriptionPeriodEnd(sub: StripeSubscription): number | null {
  return sub.items.data[0]?.current_period_end ?? sub.current_period_end ?? null
}

/** Subscription of an invoice (field moved in newer API versions). */
export function invoiceSubscriptionId(inv: StripeInvoice): string | null {
  return inv.subscription ?? inv.parent?.subscription_details?.subscription ?? null
}

export function createSubscriptionCheckout(
  cfg: StripeConfig,
  input: { workspaceId: string; tokens: number; priceCents: number; overageLimit: number; productName: string; customerId: string | null; email: string | null; successUrl: string; cancelUrl: string; locale: 'es' | 'en' },
): Promise<StripeSession> {
  return call<StripeSession>(cfg, 'POST', '/checkout/sessions', {
    mode: 'subscription',
    client_reference_id: input.workspaceId,
    ...(input.customerId ? { customer: input.customerId } : { customer_email: input.email ?? undefined }),
    locale: input.locale,
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    line_items: [
      {
        quantity: 1,
        price_data: { currency: 'usd', unit_amount: input.priceCents, recurring: { interval: 'month' }, product_data: { name: input.productName } },
      },
    ],
    metadata: { workspace_id: input.workspaceId, tokens: input.tokens },
    subscription_data: { metadata: { workspace_id: input.workspaceId, tokens: input.tokens, overage_limit: input.overageLimit } },
  })
}

export function getSubscription(cfg: StripeConfig, id: string): Promise<StripeSubscription> {
  if (!/^sub_[A-Za-z0-9_]+$/.test(id)) throw new StripeError('Invalid subscription id')
  return call<StripeSubscription>(cfg, 'GET', `/subscriptions/${id}`)
}

/**
 * New monthly plan on the same subscription. Bigger plans are charged now
 * (prorated invoice; refused if the card fails); smaller ones apply from the
 * next renewal with no refund.
 */
export function changeSubscriptionPlan(
  cfg: StripeConfig,
  sub: StripeSubscription,
  input: { tokens: number; priceCents: number; upgrade: boolean },
): Promise<StripeSubscription & { latest_invoice?: string | null }> {
  const item = sub.items.data[0]
  if (!item) throw new StripeError('Subscription has no item')
  return call(cfg, 'POST', `/subscriptions/${sub.id}`, {
    items: [{ id: item.id, price_data: { currency: 'usd', unit_amount: input.priceCents, recurring: { interval: 'month' }, product: item.price.product } }],
    metadata: { tokens: input.tokens },
    proration_behavior: input.upgrade ? 'always_invoice' : 'none',
    ...(input.upgrade ? { payment_behavior: 'error_if_incomplete' } : {}),
    // A plan change also undoes a pending cancellation.
    cancel_at_period_end: false,
  })
}

export function getInvoice(cfg: StripeConfig, id: string): Promise<StripeInvoice> {
  if (!/^in_[A-Za-z0-9_]+$/.test(id)) throw new StripeError('Invalid invoice id')
  return call<StripeInvoice>(cfg, 'GET', `/invoices/${id}`)
}

export function createPortalSession(cfg: StripeConfig, customerId: string, returnUrl: string, locale: 'es' | 'en'): Promise<{ url: string }> {
  return call<{ url: string }>(cfg, 'POST', '/billing_portal/sessions', { customer: customerId, return_url: returnUrl, locale })
}

// ------------------------------------------------------------
// Extra credits (overage), billed in arrears
//   POST /v1/invoiceitems   the extra credits used in a month, on the renewal
//                           invoice while it is a draft (invoice.created), or
//                           pending for the next one
//   POST /v1/invoices       after a cancellation, one last invoice that
//                           collects the extra credits still pending
// ------------------------------------------------------------

/** A charge on the customer's next invoice, or on `invoiceId` while that invoice is still a draft. */
export function createInvoiceItem(
  cfg: StripeConfig,
  input: { customerId: string; amountCents: number; description: string; metadata: Record<string, string>; idempotencyKey: string; invoiceId?: string | null },
): Promise<{ id: string; invoice?: string | null }> {
  return call<{ id: string; invoice?: string | null }>(
    cfg,
    'POST',
    '/invoiceitems',
    {
      customer: input.customerId,
      amount: input.amountCents,
      currency: 'usd',
      description: input.description,
      metadata: input.metadata,
      ...(input.invoiceId ? { invoice: input.invoiceId } : {}),
    },
    input.idempotencyKey,
  )
}

export function invoicePendingItems(cfg: StripeConfig, input: { customerId: string; description: string; idempotencyKey: string }): Promise<{ id: string }> {
  return call<{ id: string }>(
    cfg,
    'POST',
    '/invoices',
    { customer: input.customerId, pending_invoice_items_behavior: 'include', collection_method: 'charge_automatically', auto_advance: true, description: input.description },
    input.idempotencyKey,
  )
}

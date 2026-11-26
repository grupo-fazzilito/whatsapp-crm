import 'server-only'
import { prisma } from '@/lib/db/prisma'
import { normalizeRaw } from '@/lib/db/compat'
import { getBillingSettings } from './settings'
import { notifyBilling } from './credits'
import { defaultOverageLimit, monthlyCents, validOverageLimit } from './subscription-pricing'
import { closeOverage, invoiceOverageAfterCancel } from './overage'
import {
  changeSubscriptionPlan,
  createPortalSession,
  createSubscriptionCheckout,
  getInvoice,
  getSubscription,
  invoiceSubscriptionId,
  stripeConfig,
  StripeError,
  subscriptionPeriodEnd,
  type StripeConfig,
  type StripeEventRef,
  type StripeSubscription,
} from './stripe'

// Monthly credit subscription (Stripe, US$, every region): one plan, US$ 9.90
// for 1,000 credits, plus extra credits when they run out, billed prorated on
// the next invoice (see ./overage). Credits come from paid invoices only: each one is read back
// from Stripe's API and applied once (subscription_invoices). On a new month
// the unused credits of the previous one (plan and extra) expire and the
// plan's quota is granted again.

export interface TokenSubscription {
  tokens: number
  price_cents: number
  currency: string
  status: string
  current_period_end: string | null
  cancel_at_period_end: boolean
  /** Most extra credits a month. */
  overage_limit: number
}

/** Grace after the period end, so tokens don't vanish while the renewal invoice is being paid. */
const GRACE_MS = 3 * 86_400_000

const ACTIVE = new Set(['active', 'trialing', 'past_due'])

function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3001').replace(/\/+$/, '')
}

const billingUrl = () => `${siteUrl()}/settings?tab=billing`

export async function getTokenSubscription(workspaceId: string): Promise<TokenSubscription | null> {
  const row = await prisma.token_subscriptions.findUnique({ where: { workspace_id: workspaceId } })
  if (!row) return null
  return {
    tokens: row.tokens,
    price_cents: row.price_cents,
    currency: row.currency,
    status: row.status,
    current_period_end: row.current_period_end ? new Date(row.current_period_end).toISOString() : null,
    cancel_at_period_end: row.cancel_at_period_end,
    overage_limit: row.overage_limit,
  }
}

/**
 * True while the workspace pays the plan (active, trial or a renewal being
 * retried), up to a few days past its period end: unlimited accounts and
 * extra credits. False on a DB error (treated as the free plan).
 */
export async function hasActiveSubscription(workspaceId: string, now = new Date()): Promise<boolean> {
  try {
    const row = await prisma.token_subscriptions.findUnique({ where: { workspace_id: workspaceId }, select: { status: true, current_period_end: true } })
    if (!row || !ACTIVE.has(row.status)) return false
    return !row.current_period_end || new Date(row.current_period_end).getTime() + GRACE_MS > now.getTime()
  } catch (err) {
    console.error('[billing] hasActiveSubscription failed:', err instanceof Error ? err.message : err)
    return false
  }
}

export type SubscribeError = 'invalid_tokens' | 'invalid_limit' | 'gateway_not_configured' | 'already_subscribed' | 'gateway_error' | 'not_subscribed' | 'payment_failed'

/**
 * Stripe Checkout for the plan (with the extra-credit limit chosen), or, on a
 * subscription set to end, undo the cancellation.
 */
export async function subscribe(input: {
  workspaceId: string
  userId: string
  overageLimit?: unknown
}): Promise<{ ok: true; url?: string; subscription?: TokenSubscription } | { ok: false; error: SubscribeError; detail?: string }> {
  const cfg = stripeConfig()
  if (!cfg) return { ok: false, error: 'gateway_not_configured' }
  const pricing = (await getBillingSettings()).subscription
  const overageLimit = input.overageLimit === undefined || input.overageLimit === null ? defaultOverageLimit(pricing) : validOverageLimit(input.overageLimit, pricing)
  if (!overageLimit) return { ok: false, error: 'invalid_limit' }

  const current = await prisma.token_subscriptions.findUnique({ where: { workspace_id: input.workspaceId } })
  if (current && ACTIVE.has(current.status)) {
    if (!current.cancel_at_period_end) return { ok: false, error: 'already_subscribed' }
    // Resume: same plan as today.
    return changePlan(cfg, input.workspaceId, current.subscription_id, current.tokens, current.price_cents)
  }
  const tokens = pricing.step_tokens
  const priceCents = monthlyCents(tokens, pricing)

  const [account, profile, ws] = await Promise.all([
    prisma.billing_accounts.findFirst({ where: { workspace_id: input.workspaceId }, select: { email: true } }),
    prisma.profiles.findUnique({ where: { user_id: input.userId }, select: { email: true } }),
    prisma.workspaces.findUnique({ where: { id: input.workspaceId }, select: { locale: true } }),
  ])
  const locale = ws?.locale === 'en' ? 'en' : 'es'
  try {
    const session = await createSubscriptionCheckout(cfg, {
      workspaceId: input.workspaceId,
      tokens,
      priceCents,
      overageLimit,
      productName: locale === 'en' ? `Whasalia — ${tokens.toLocaleString('en-US')} credits / month` : `Whasalia — ${tokens.toLocaleString('es-PE')} créditos al mes`,
      // A canceled subscription's customer keeps its card and invoices.
      customerId: current?.customer_id ?? null,
      email: account?.email || profile?.email || null,
      successUrl: `${billingUrl()}&subscribed=1`,
      cancelUrl: billingUrl(),
      locale,
    })
    if (!session.url) return { ok: false, error: 'gateway_error' }
    return { ok: true, url: session.url }
  } catch (err) {
    console.error('[subscription] checkout failed:', err instanceof Error ? err.message : err)
    return { ok: false, error: 'gateway_error', detail: err instanceof StripeError ? err.message : undefined }
  }
}

async function changePlan(cfg: StripeConfig, workspaceId: string, subscriptionId: string, tokens: number, priceCents: number) {
  const row = await prisma.token_subscriptions.findUnique({ where: { workspace_id: workspaceId } })
  if (!row) return { ok: false as const, error: 'not_subscribed' as const }
  if (row.tokens === tokens && !row.cancel_at_period_end) return { ok: true as const, subscription: (await getTokenSubscription(workspaceId)) ?? undefined }
  const upgrade = tokens > row.tokens
  let updated: Awaited<ReturnType<typeof changeSubscriptionPlan>>
  try {
    const sub = await getSubscription(cfg, subscriptionId)
    updated = await changeSubscriptionPlan(cfg, sub, { tokens, priceCents, upgrade })
  } catch (err) {
    console.error('[subscription] plan change failed:', err instanceof Error ? err.message : err)
    // error_if_incomplete: the prorated charge was declined, nothing changed.
    const declined = err instanceof StripeError && err.status === 402
    return { ok: false as const, error: declined ? ('payment_failed' as const) : ('gateway_error' as const), detail: err instanceof StripeError ? err.message : undefined }
  }
  await saveSubscription(workspaceId, updated, { tokens, priceCents })
  // A bigger plan was just paid (prorated): the extra tokens for the rest of this month, now.
  if (upgrade && updated.latest_invoice) await applyInvoice(cfg, updated.latest_invoice, { extraTokens: tokens - row.tokens, workspaceId })
  return { ok: true as const, subscription: (await getTokenSubscription(workspaceId)) ?? undefined }
}

/** Changes the most extra credits a subscriber may use a month (from now on, this period included). */
export async function setOverageLimit(workspaceId: string, raw: unknown): Promise<{ ok: true; overage_limit: number } | { ok: false; error: 'invalid_limit' | 'not_subscribed' }> {
  const limit = validOverageLimit(raw, (await getBillingSettings()).subscription)
  if (!limit) return { ok: false, error: 'invalid_limit' }
  const done = await prisma.token_subscriptions.updateMany({ where: { workspace_id: workspaceId }, data: { overage_limit: limit, updated_at: new Date() } })
  if (!done.count) return { ok: false, error: 'not_subscribed' }
  return { ok: true, overage_limit: limit }
}

/** Stripe's customer portal: card, invoices and cancellation. */
export async function portalUrl(workspaceId: string, locale: 'es' | 'en'): Promise<string | null> {
  const cfg = stripeConfig()
  const row = await prisma.token_subscriptions.findUnique({ where: { workspace_id: workspaceId }, select: { customer_id: true } })
  if (!cfg || !row) return null
  return (await createPortalSession(cfg, row.customer_id, billingUrl(), locale)).url
}

async function saveSubscription(workspaceId: string, sub: StripeSubscription, plan?: { tokens: number; priceCents: number }) {
  const tokens = plan?.tokens ?? (Number(sub.metadata?.tokens) || 0)
  const priceCents = plan?.priceCents ?? sub.items.data[0]?.price.unit_amount ?? 0
  const end = subscriptionPeriodEnd(sub)
  const data = {
    customer_id: sub.customer,
    subscription_id: sub.id,
    status: sub.status,
    cancel_at_period_end: !!sub.cancel_at_period_end,
    current_period_end: end ? new Date(end * 1000) : null,
    updated_at: new Date(),
    ...(tokens > 0 ? { tokens } : {}),
    ...(priceCents > 0 ? { price_cents: priceCents } : {}),
  }
  if (tokens <= 0 || priceCents <= 0) {
    // Only status changes for a subscription we already know.
    await prisma.token_subscriptions.updateMany({ where: { workspace_id: workspaceId }, data })
    return
  }
  // The extra-credit limit chosen at checkout (only when the row is created; later it is edited here).
  const pricing = (await getBillingSettings()).subscription
  const overageLimit = validOverageLimit(Number(sub.metadata?.overage_limit), pricing) ?? defaultOverageLimit(pricing)
  await prisma.token_subscriptions.upsert({
    where: { workspace_id: workspaceId },
    create: { workspace_id: workspaceId, ...data, tokens, price_cents: priceCents, currency: 'USD', overage_limit: overageLimit },
    update: data,
  })
}

/** Workspace of a subscription: our row, else the metadata we put on it at checkout. */
async function workspaceOf(sub: StripeSubscription): Promise<string | null> {
  const row = await prisma.token_subscriptions.findUnique({ where: { subscription_id: sub.id }, select: { workspace_id: true } })
  if (row) return row.workspace_id
  const ws = sub.metadata?.workspace_id
  if (!ws || !/^[0-9a-f-]{36}$/i.test(ws)) return null
  return (await prisma.workspaces.findUnique({ where: { id: ws }, select: { id: true } }))?.id ?? null
}

/**
 * A paid invoice → tokens, once. New period (create / cycle): the previous
 * month's subscription tokens expire and the plan's quota is granted until the
 * period end. Upgrade (prorated): only the extra tokens.
 */
async function applyInvoice(cfg: StripeConfig, invoiceId: string, opts: { extraTokens?: number; workspaceId?: string } = {}): Promise<void> {
  const inv = await getInvoice(cfg, invoiceId)
  if (inv.status !== 'paid') return
  const subId = invoiceSubscriptionId(inv)
  if (!subId) return
  const sub = await getSubscription(cfg, subId)
  const workspaceId = opts.workspaceId ?? (await workspaceOf(sub))
  if (!workspaceId) {
    console.warn(`[subscription] invoice ${inv.id}: no workspace for ${subId}`)
    return
  }
  await saveSubscription(workspaceId, sub)
  const plan = Number(sub.metadata?.tokens) || (await prisma.token_subscriptions.findUnique({ where: { workspace_id: workspaceId }, select: { tokens: true } }))?.tokens || 0
  const newPeriod = inv.billing_reason === 'subscription_create' || inv.billing_reason === 'subscription_cycle'
  const tokens = newPeriod ? plan : Math.max(0, opts.extraTokens ?? 0)

  // Claim the invoice first: a repeated webhook (or the upgrade call and its webhook) applies it once.
  try {
    await prisma.subscription_invoices.create({
      data: {
        invoice_id: inv.id,
        workspace_id: workspaceId,
        reason: inv.billing_reason,
        tokens,
        amount_cents: inv.amount_paid,
        currency: inv.currency.toUpperCase(),
        period_start: inv.period_start ? new Date(inv.period_start * 1000) : null,
        period_end: inv.period_end ? new Date(inv.period_end * 1000) : null,
        hosted_url: inv.hosted_invoice_url ?? null,
      },
    })
  } catch {
    return
  }
  if (tokens <= 0) return

  const periodEnd = (subscriptionPeriodEnd(sub) ?? Math.floor(Date.now() / 1000) + 31 * 86_400) * 1000
  const expires = new Date(periodEnd + GRACE_MS)
  try {
    if (newPeriod) {
      // Extra credits of the month that ended are counted first (if invoice.created didn't), then
      // the unused credits of that month (plan and extra) expire.
      await closeOverage(workspaceId)
      await prisma.$executeRaw`UPDATE public.credit_lots SET expires_at = NOW() WHERE workspace_id = ${workspaceId}::uuid AND source IN ('subscription', 'overage') AND credits_remaining > 0`
      await prisma.$queryRaw`SELECT public.expire_credit_lots()`
    }
    const why = `${inv.billing_reason ?? 'invoice'} ${inv.id}`
    normalizeRaw(await prisma.$queryRaw`SELECT public.grant_credits(${workspaceId}::uuid, ${tokens}::int, 'subscription', ${expires}::timestamptz, NULL::uuid, ${why}::text, NULL::uuid)`)
  } catch (err) {
    // Let the next delivery try again.
    await prisma.subscription_invoices.deleteMany({ where: { invoice_id: inv.id } }).catch(() => {})
    throw err
  }
  await notifyBilling(workspaceId, 'paid', tokens).catch(() => {})
}

/** Stripe webhook events about subscriptions (signature checked by the route). */
export async function handleSubscriptionEvent(event: StripeEventRef): Promise<'ok' | 'ignored'> {
  const cfg = stripeConfig()
  if (!cfg) return 'ignored'
  if (event.type === 'checkout.session.completed' && event.mode === 'subscription' && event.subscriptionId) {
    const sub = await getSubscription(cfg, event.subscriptionId)
    const workspaceId = await workspaceOf(sub)
    if (!workspaceId) return 'ignored'
    await saveSubscription(workspaceId, sub)
    return 'ok'
  }
  if (event.type.startsWith('customer.subscription.') && event.subscriptionId) {
    const sub = await getSubscription(cfg, event.subscriptionId)
    const workspaceId = await workspaceOf(sub)
    if (!workspaceId) return 'ignored'
    await saveSubscription(workspaceId, sub)
    // No renewal will carry the extra credits of the last month: bill them now.
    if (event.type === 'customer.subscription.deleted') await invoiceOverageAfterCancel(workspaceId, sub.id)
    return 'ok'
  }
  // The renewal draft: the month that just ended closes and its extra credits go on it.
  if (event.type === 'invoice.created' && event.invoiceId) {
    const inv = await getInvoice(cfg, event.invoiceId)
    const subId = invoiceSubscriptionId(inv)
    if (!subId || inv.status !== 'draft' || inv.billing_reason !== 'subscription_cycle') return 'ignored'
    const workspaceId = await workspaceOf(await getSubscription(cfg, subId))
    if (!workspaceId) return 'ignored'
    await closeOverage(workspaceId, { invoiceId: inv.id })
    return 'ok'
  }
  if (event.type === 'invoice.paid' && event.invoiceId) {
    await applyInvoice(cfg, event.invoiceId)
    return 'ok'
  }
  if (event.type === 'invoice.payment_failed' && event.invoiceId) {
    const inv = await getInvoice(cfg, event.invoiceId)
    const subId = invoiceSubscriptionId(inv)
    if (!subId) return 'ignored'
    const sub = await getSubscription(cfg, subId)
    const workspaceId = await workspaceOf(sub)
    if (workspaceId) await saveSubscription(workspaceId, sub)
    return 'ok'
  }
  return 'ignored'
}

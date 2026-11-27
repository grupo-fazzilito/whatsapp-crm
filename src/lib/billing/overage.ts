import 'server-only'
import { prisma } from '@/lib/db/prisma'
import { getBillingSettings } from './settings'
import { createInvoiceItem, invoicePendingItems, stripeConfig, StripeError } from './stripe'
import { overageCentsFor, pricingForProvider, type SubscriptionPricing, type SubscriptionProvider } from './subscription-pricing'

// Extra credits for subscribers. When a subscribed business runs out of
// credits, more are handed out at once (lots of up to 1,000), up to the limit
// it set. Only what is actually used is billed, prorated (US$ 3 per 1,000 →
// 100 credits = US$ 0.30): when the period closes (Stripe's renewal draft,
// invoice.created) the used extra credits are counted, the rest expire, and
// the amount goes on that invoice as one line.

const ACTIVE = new Set(['active', 'trialing', 'past_due'])
/** Same grace as the plan's credits: the renewal may take a few days to be paid. */
const GRACE_MS = 3 * 86_400_000

export interface OverageUsage {
  /** Most extra credits this month. */
  limit: number
  /** Extra credits used so far this period, and what they cost (cents). */
  credits: number
  cents: number
}

interface Current {
  periodEnd: Date
  limit: number
}

/** The subscriber's open period, or null (not subscribed, or past its grace). */
async function currentPeriod(workspaceId: string, now: Date): Promise<Current | null> {
  const sub = await prisma.token_subscriptions.findUnique({
    where: { workspace_id: workspaceId },
    select: { status: true, current_period_end: true, overage_limit: true },
  })
  if (!sub || !ACTIVE.has(sub.status) || !sub.current_period_end) return null
  const periodEnd = new Date(sub.current_period_end)
  if (periodEnd.getTime() + GRACE_MS <= now.getTime()) return null
  return { periodEnd, limit: sub.overage_limit }
}

/**
 * Hands out extra credits until the balance covers `needed`, within the
 * limit. Returns the credits added (0: not subscribed, at the limit, or not
 * needed) and whether they are the first extra credits of the period.
 * Serialized per workspace, so concurrent replies never double up.
 */
export async function topUpOverage(workspaceId: string, needed: number, now = new Date()): Promise<{ added: number; first: boolean }> {
  const cur = await currentPeriod(workspaceId, now)
  if (!cur) return { added: 0, first: false }
  const lot = (await getBillingSettings()).subscription.step_tokens
  const expires = new Date(cur.periodEnd.getTime() + GRACE_MS)

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`overage:${workspaceId}`}))::text AS locked`
    const [row] = await tx.$queryRaw<{ v: unknown }[]>`SELECT public.credit_balance(${workspaceId}::uuid) AS v`
    let balance = Number(row?.v ?? 0)
    const given = await tx.subscription_overage_grants.aggregate({ where: { workspace_id: workspaceId, period_end: cur.periodEnd }, _sum: { credits: true } })
    const before = given._sum.credits ?? 0
    let room = cur.limit - before
    let added = 0
    while (balance < needed && room > 0) {
      const credits = Math.min(lot, room)
      const [g] = await tx.$queryRaw<{ id: string }[]>`SELECT public.grant_credits(${workspaceId}::uuid, ${credits}::int, 'overage', ${expires}::timestamptz, NULL::uuid, 'extra credits'::text, NULL::uuid)::text AS id`
      await tx.subscription_overage_grants.create({ data: { workspace_id: workspaceId, period_end: cur.periodEnd, lot_id: g.id, credits } })
      balance += credits
      room -= credits
      added += credits
    }
    return { added, first: added > 0 && before === 0 }
  })
}

/** True when a subscriber may still get extra credits this period. Never throws. */
export async function overageRoom(workspaceId: string, now = new Date()): Promise<boolean> {
  try {
    const cur = await currentPeriod(workspaceId, now)
    if (!cur) return false
    const given = await prisma.subscription_overage_grants.aggregate({ where: { workspace_id: workspaceId, period_end: cur.periodEnd }, _sum: { credits: true } })
    return (given._sum.credits ?? 0) < cur.limit
  } catch {
    return false
  }
}

/**
 * Extra credits used from a period's lots: handed out, minus what is left and
 * what already expired (expiry zeroes the lot but logs how much it took).
 */
async function usedInPeriod(workspaceId: string, periodEnd: Date): Promise<number> {
  const [row] = await prisma.$queryRaw<{ used: unknown }[]>`
    SELECT COALESCE(SUM(l.credits_total - l.credits_remaining + COALESCE((
      SELECT SUM(e.credits) FROM public.credit_ledger e WHERE e.lot_id = l.id AND e.kind = 'expiry'
    ), 0)), 0) AS used
    FROM public.subscription_overage_grants g
    JOIN public.credit_lots l ON l.id = g.lot_id
    WHERE g.workspace_id = ${workspaceId}::uuid AND g.period_end = ${periodEnd}`
  return Math.max(0, Number(row?.used ?? 0))
}

/** The plan's prices in the currency this business is charged in (soles with Culqi). */
async function pricingOf(workspaceId: string): Promise<SubscriptionPricing> {
  const sub = await prisma.token_subscriptions.findUnique({ where: { workspace_id: workspaceId }, select: { provider: true } })
  const provider: SubscriptionProvider = sub?.provider === 'culqi' ? 'culqi' : 'stripe'
  return pricingForProvider((await getBillingSettings()).subscription, provider)
}

const DESCRIPTION = {
  es: (n: number) => `${n.toLocaleString('es-PE')} créditos adicionales del mes anterior`,
  en: (n: number) => `${n.toLocaleString('en-US')} extra credits from last month`,
}

/**
 * Closes every ended period that had extra credits (once each): counts what
 * was used, expires the rest and records the amount. Stripe: billed on
 * `invoiceId` (the renewal draft) or as a pending item for the next invoice.
 * Culqi: left for the renewal charge to collect. Returns the cents billed to Stripe.
 */
export async function closeOverage(workspaceId: string, opts: { invoiceId?: string | null; includeCurrent?: boolean; now?: Date } = {}): Promise<number> {
  const now = opts.now ?? new Date()
  // Stripe creates the renewal draft at the period end; a little slack for clocks.
  const cutoff = opts.includeCurrent ? new Date(8.64e15) : new Date(now.getTime() + 3_600_000)
  const ended = await prisma.subscription_overage_grants.findMany({
    where: { workspace_id: workspaceId, period_end: { lte: cutoff } },
    distinct: ['period_end'],
    select: { period_end: true },
  })
  const pricing = await pricingOf(workspaceId)
  let billed = 0
  for (const { period_end } of ended) {
    const periodEnd = new Date(period_end)
    const already = await prisma.subscription_overage_periods.findUnique({ where: { workspace_id_period_end: { workspace_id: workspaceId, period_end: periodEnd } } })
    if (already) continue
    const used = await usedInPeriod(workspaceId, periodEnd)
    const cents = overageCentsFor(used, pricing)
    try {
      await prisma.subscription_overage_periods.create({ data: { workspace_id: workspaceId, period_end: periodEnd, credits_used: used, amount_cents: cents } })
    } catch {
      continue // closed by a concurrent delivery
    }
    // What was not used isn't billed and goes away with the period.
    await prisma.$executeRaw`UPDATE public.credit_lots SET expires_at = NOW() WHERE credits_remaining > 0 AND id IN (
      SELECT lot_id FROM public.subscription_overage_grants WHERE workspace_id = ${workspaceId}::uuid AND period_end = ${periodEnd})`
    await prisma.$queryRaw`SELECT public.expire_credit_lots()::text AS n`
    if (cents > 0) billed += (await billPeriod(workspaceId, periodEnd, opts.invoiceId ?? null)) ? cents : 0
  }
  return billed
}

/** Stripe invoice item for a closed period (idempotent). False if it couldn't be created yet. */
async function billPeriod(workspaceId: string, periodEnd: Date, invoiceId: string | null): Promise<boolean> {
  const cfg = stripeConfig()
  const [p, ws] = await Promise.all([
    prisma.subscription_overage_periods.findUnique({ where: { workspace_id_period_end: { workspace_id: workspaceId, period_end: periodEnd } } }),
    prisma.workspaces.findUnique({ where: { id: workspaceId }, select: { locale: true, token_subscriptions: { select: { customer_id: true, provider: true } } } }),
  ])
  // Culqi plans: the monthly charge collects it.
  if (ws?.token_subscriptions?.provider === 'culqi') return false
  const customerId = ws?.token_subscriptions?.customer_id
  if (!cfg || !p || p.invoice_item_id || p.amount_cents <= 0 || !customerId) return !!p?.invoice_item_id
  const key = `overage-${workspaceId}-${periodEnd.getTime()}`
  const create = (invoice: string | null) =>
    createInvoiceItem(cfg, {
      customerId,
      amountCents: p.amount_cents,
      description: DESCRIPTION[ws?.locale === 'en' ? 'en' : 'es'](p.credits_used),
      metadata: { workspace_id: workspaceId, period_end: periodEnd.toISOString(), credits: String(p.credits_used) },
      idempotencyKey: invoice ? `${key}-${invoice}` : key,
      invoiceId: invoice,
    })
  try {
    let item: { id: string; invoice?: string | null }
    try {
      item = await create(invoiceId)
    } catch (err) {
      // The draft may be finalized already: leave it pending for the next invoice.
      if (!invoiceId || !(err instanceof StripeError)) throw err
      item = await create(null)
    }
    await prisma.subscription_overage_periods.updateMany({
      where: { workspace_id: workspaceId, period_end: periodEnd },
      data: { invoice_item_id: item.id, invoice_id: item.invoice ?? invoiceId ?? null },
    })
    return true
  } catch (err) {
    console.error(`[overage] invoice item for ${workspaceId} failed:`, err instanceof Error ? err.message : err)
    return false
  }
}

/**
 * Billing cron: periods that ended a day ago and were never closed (the
 * renewal webhook didn't arrive) are closed now; the amount goes on the next invoice.
 */
export async function closeStaleOverage(now = new Date()): Promise<number> {
  const rows = await prisma.$queryRaw<{ workspace_id: string }[]>`
    SELECT DISTINCT g.workspace_id::text AS workspace_id FROM public.subscription_overage_grants g
    WHERE g.period_end < ${new Date(now.getTime() - 86_400_000)}
      AND NOT EXISTS (SELECT 1 FROM public.subscription_overage_periods p WHERE p.workspace_id = g.workspace_id AND p.period_end = g.period_end)
    LIMIT 100`
  for (const r of rows) await closeOverage(r.workspace_id, { now }).catch((err) => console.error('[overage] close failed:', err instanceof Error ? err.message : err))
  return rows.length
}

/** Billing cron: closed periods whose invoice item couldn't be created yet. */
export async function retryOverageBilling(): Promise<number> {
  const rows = await prisma.subscription_overage_periods.findMany({
    // Stripe only: Culqi plans collect it in the monthly charge.
    where: { invoice_item_id: null, amount_cents: { gt: 0 }, workspaces: { token_subscriptions: { provider: 'stripe' } } },
    select: { workspace_id: true, period_end: true },
    take: 100,
  })
  let n = 0
  for (const r of rows) if (await billPeriod(r.workspace_id, new Date(r.period_end), null)) n += 1
  return n
}

/**
 * After a subscription ends there is no renewal to carry the extra credits:
 * the last period is closed and one final invoice collects them.
 */
export async function invoiceOverageAfterCancel(workspaceId: string, subscriptionId: string): Promise<void> {
  const cfg = stripeConfig()
  const customer = await prisma.token_subscriptions.findUnique({ where: { workspace_id: workspaceId }, select: { customer_id: true } })
  if (!cfg || !customer) return
  if ((await closeOverage(workspaceId, { includeCurrent: true })) <= 0) return
  try {
    await invoicePendingItems(cfg, { customerId: customer.customer_id, description: 'Whasalia', idempotencyKey: `overage-final-${subscriptionId}` })
  } catch (err) {
    if (!(err instanceof StripeError)) throw err
    console.warn('[overage] final invoice:', err.message)
  }
}

/** Extra credits used in the current period, for the billing screen. */
export async function overageUsage(workspaceId: string, pricing?: SubscriptionPricing): Promise<OverageUsage | null> {
  const sub = await prisma.token_subscriptions.findUnique({ where: { workspace_id: workspaceId }, select: { overage_limit: true, current_period_end: true } })
  if (!sub) return null
  const p = pricing ?? (await pricingOf(workspaceId))
  const used = sub.current_period_end ? await usedInPeriod(workspaceId, new Date(sub.current_period_end)) : 0
  return { limit: sub.overage_limit, credits: used, cents: overageCentsFor(used, p) }
}

export interface InvoiceView {
  id: string
  created_at: string
  reason: string | null
  amount_cents: number
  currency: string
  credits: number
  hosted_url: string | null
  /** The month this charge pays for. */
  period_start: string | null
  period_end: string | null
  /** Extra credits of the previous month billed on this invoice. */
  overage_credits: number
  overage_cents: number
}

/** The business's paid subscription invoices (newest first) for Settings → Billing. */
export async function subscriptionInvoices(workspaceId: string, take = 24): Promise<InvoiceView[]> {
  const [rows, periods] = await Promise.all([
    prisma.subscription_invoices.findMany({ where: { workspace_id: workspaceId }, orderBy: { created_at: 'desc' }, take }),
    prisma.subscription_overage_periods.findMany({ where: { workspace_id: workspaceId, invoice_id: { not: null } }, select: { invoice_id: true, credits_used: true, amount_cents: true } }),
  ])
  const byInvoice = new Map(periods.map((p) => [p.invoice_id, p]))
  return rows.map((r) => {
    const o = byInvoice.get(r.invoice_id)
    return {
      id: r.invoice_id,
      created_at: new Date(r.created_at).toISOString(),
      reason: r.reason,
      amount_cents: r.amount_cents,
      currency: r.currency,
      credits: r.tokens,
      hosted_url: r.hosted_url,
      period_start: r.period_start ? new Date(r.period_start).toISOString() : null,
      period_end: r.period_end ? new Date(r.period_end).toISOString() : null,
      overage_credits: o?.credits_used ?? 0,
      overage_cents: o?.amount_cents ?? 0,
    }
  })
}

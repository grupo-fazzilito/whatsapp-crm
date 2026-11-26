import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { creditBalance } from '@/lib/billing/credits'
import { getBillingSettings, getPaymentLatamConfig } from '@/lib/billing/settings'
import { workspacePlan } from '@/lib/billing/plan-store'
import { pricingFor } from '@/lib/billing/pricing'
import { workspaceRegion } from '@/lib/regions-server'
import { REGION_INFO } from '@/lib/regions'
import { stripeConfig } from '@/lib/billing/stripe'
import { getTokenSubscription } from '@/lib/billing/subscriptions'
import { overageUsage, subscriptionInvoices } from '@/lib/billing/overage'

/**
 * GET /api/billing (admins) → plan, balance, next expiry, prices, payer data,
 * recent payments, recent movements and this month's usage by action.
 */
export async function GET() {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const ws = guard.ctx.workspace.id
  // A failed query reads as empty, as before.
  const safe = <T,>(p: Promise<T>) => p.then((data) => ({ data }), (err) => {
    console.error('[billing] query failed:', err instanceof Error ? err.message : err)
    return { data: null as T | null }
  })
  const db = guard.ctx.db
  const monthStart = new Date()
  monthStart.setUTCDate(1)
  monthStart.setUTCHours(0, 0, 0, 0)

  const [subscription, overage, invoices, region, plan, balance, settings, gateway, account, lots, payments, ledger, usage] = await Promise.all([
    getTokenSubscription(ws).catch(() => null),
    overageUsage(ws).catch(() => null),
    subscriptionInvoices(ws).catch(() => []),
    workspaceRegion(ws),
    workspacePlan(ws),
    creditBalance(ws),
    getBillingSettings(),
    getPaymentLatamConfig(),
    safe(db.billing_accounts.findFirst({ where: { workspace_id: ws }, select: { doc_type: true, doc_number: true, legal_name: true, email: true } })),
    safe(db.credit_lots.findMany({ where: { credits_remaining: { gt: 0 }, expires_at: { gt: new Date() } }, select: { credits_remaining: true, expires_at: true, source: true }, orderBy: { expires_at: 'asc' }, take: 20 })),
    safe(db.billing_payments.findMany({ select: { id: true, amount: true, currency: true, credits: true, status: true, checkout_url: true, expires_on: true, paid_at: true, error: true, created_at: true }, orderBy: { created_at: 'desc' }, take: 20 })),
    safe(db.credit_ledger.findMany({ select: { id: true, kind: true, credits: true, action: true, conversation_id: true, note: true, created_at: true }, orderBy: { created_at: 'desc' }, take: 50 })),
    safe(db.credit_ledger.findMany({ where: { kind: 'usage', created_at: { gte: monthStart } }, select: { action: true, credits: true }, take: 20000 })),
  ])

  const byAction: Record<string, number> = {}
  for (const u of usage.data ?? []) byAction[u.action ?? 'other'] = (byAction[u.action ?? 'other'] ?? 0) - u.credits
  const next = lots.data?.[0] ?? null
  // Prices and gateway of the account's sales region (Peru: soles, Payment Latam).
  const prices = pricingFor(settings, region)
  const gatewayName = REGION_INFO[region].gateway
  const gatewayReady = gatewayName === 'payment_latam' ? !!gateway : gatewayName === 'stripe' ? !!stripeConfig() : false

  return NextResponse.json({
    plan: { id: plan.id, name: plan.name, price: plan.price },
    balance,
    next_expiry: next ? { at: next.expires_at, credits: next.credits_remaining } : null,
    lots: lots.data ?? [],
    settings: {
      region,
      gateway: gatewayName,
      currency: prices.currency,
      credit_price: prices.credit_price,
      min_topup: prices.min_topup,
      packs: prices.packs,
      expiry_months: settings.expiry_months,
      action_costs: settings.action_costs,
      low_credit_threshold: settings.low_credit_threshold,
      enforce: settings.enforce,
    },
    gateway_ready: gatewayReady,
    // Tokens are sold by monthly subscription (Stripe, US$).
    subscription,
    /** Extra credits used this period (subscribers), billed prorated on the next invoice. */
    overage,
    /** Paid subscription invoices, newest first, with the extra credits each one carried. */
    invoices,
    subscription_pricing: settings.subscription,
    subscription_ready: !!stripeConfig(),
    account: account.data ?? null,
    payments: payments.data ?? [],
    ledger: ledger.data ?? [],
    usage_month: byAction,
  })
}

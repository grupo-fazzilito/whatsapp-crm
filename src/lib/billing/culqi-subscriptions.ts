import 'server-only'
import { prisma } from '@/lib/db/prisma'
import { normalizeRaw } from '@/lib/db/compat'
import { getBillingSettings } from './settings'
import { BILLING_LINK, notifyBilling } from './credits'
import { closeOverage } from './overage'
import { cardLabel, chargeCard, createCard, createCustomer, culqiConfig, CulqiError, type CulqiConfig } from './culqi'
import { defaultOverageLimit, monthlyCents, pricingForProvider, validOverageLimit, type SubscriptionPricing } from './subscription-pricing'

// The credit plan charged with Culqi (Peru, soles). Culqi Checkout turns the
// card into a token in the browser; we save it on a Culqi customer and charge
// the saved card ourselves: the first month when subscribing, then every
// month (a cron) the plan plus the previous month's extra credits in one
// charge. A failed renewal is retried once a day; after the grace days the
// plan ends and the business is back on the free plan.

const PROVIDER = 'culqi'
const ACTIVE = new Set(['active', 'trialing', 'past_due'])
/** Same grace as the plan's credits. */
const GRACE_MS = 3 * 86_400_000
/** A failed renewal is tried again after this long. */
const RETRY_MS = 20 * 3_600_000

export type CulqiSubscribeError =
  | 'gateway_not_configured'
  | 'already_subscribed'
  | 'billing_profile_incomplete'
  | 'invalid_limit'
  | 'invalid_token'
  | 'payment_failed'
  | 'gateway_error'
  | 'not_subscribed'

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: CulqiSubscribeError; detail?: string | null }

async function planPricing(): Promise<SubscriptionPricing> {
  return pricingForProvider((await getBillingSettings()).subscription, PROVIDER)
}

/** The same calendar day next month (the 31st becomes the last day of a shorter month). */
export function addMonth(d: Date): Date {
  const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()))
  const last = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate()
  next.setUTCDate(Math.min(d.getUTCDate(), last))
  return next
}

function failure(err: unknown): { error: CulqiSubscribeError; detail: string | null } {
  if (err instanceof CulqiError) {
    const declined = err.type === 'card_error' || err.status === 402
    if (err.code === 'invalid_token') return { error: 'invalid_token', detail: null }
    return { error: declined ? 'payment_failed' : 'gateway_error', detail: err.userMessage ?? err.message }
  }
  return { error: 'gateway_error', detail: null }
}

/**
 * The month's credits: the previous ones (plan and extra) expire, the plan's
 * quota is granted until the period end, and the charge goes in the history.
 */
async function applyPaidMonth(input: {
  workspaceId: string
  chargeId: string
  reason: 'subscription_create' | 'subscription_cycle'
  tokens: number
  amountCents: number
  periodStart: Date
  periodEnd: Date
}) {
  const { workspaceId } = input
  await prisma.subscription_invoices.create({
    data: {
      invoice_id: input.chargeId,
      workspace_id: workspaceId,
      reason: input.reason,
      tokens: input.tokens,
      amount_cents: input.amountCents,
      currency: 'PEN',
      period_start: input.periodStart,
      period_end: input.periodEnd,
    },
  })
  await prisma.$executeRaw`UPDATE public.credit_lots SET expires_at = NOW() WHERE workspace_id = ${workspaceId}::uuid AND source IN ('subscription', 'overage') AND credits_remaining > 0`
  await prisma.$queryRaw`SELECT public.expire_credit_lots()::text AS n`
  const expires = new Date(input.periodEnd.getTime() + GRACE_MS)
  const why = `${input.reason} ${input.chargeId}`
  normalizeRaw(await prisma.$queryRaw`SELECT public.grant_credits(${workspaceId}::uuid, ${input.tokens}::int, 'subscription', ${expires}::timestamptz, NULL::uuid, ${why}::text, NULL::uuid)::text AS lot`)
  await notifyBilling(workspaceId, 'paid', input.tokens).catch(() => {})
}

/** The business's data Culqi needs, or null when the billing details are incomplete. */
async function payer(workspaceId: string) {
  const a = await prisma.billing_accounts.findUnique({
    where: { workspace_id: workspaceId },
    select: { legal_name: true, email: true, address: true, city: true, phone: true },
  })
  if (!a?.legal_name || !a.email || !a.address || !a.city || !a.phone) return null
  const parts = a.legal_name.trim().split(/\s+/)
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' ') || parts[0],
    email: a.email,
    address: a.address,
    city: a.city,
    phone: a.phone,
  }
}

/**
 * Subscribe with a card token from Culqi Checkout: save the card, charge the
 * first month and give the credits. Also for a business whose plan ended.
 */
export async function subscribeCulqi(input: { workspaceId: string; tokenId: unknown; overageLimit?: unknown }): Promise<Result> {
  const cfg = culqiConfig()
  if (!cfg) return { ok: false, error: 'gateway_not_configured' }
  if (typeof input.tokenId !== 'string') return { ok: false, error: 'invalid_token' }
  const pricing = await planPricing()
  const overageLimit = input.overageLimit === undefined || input.overageLimit === null ? defaultOverageLimit(pricing) : validOverageLimit(input.overageLimit, pricing)
  if (!overageLimit) return { ok: false, error: 'invalid_limit' }
  const current = await prisma.token_subscriptions.findUnique({ where: { workspace_id: input.workspaceId } })
  if (current && ACTIVE.has(current.status)) return { ok: false, error: 'already_subscribed' }
  const who = await payer(input.workspaceId)
  if (!who) return { ok: false, error: 'billing_profile_incomplete' }

  let customerId = current?.provider === PROVIDER ? current.customer_id : null
  let card
  try {
    if (!customerId) customerId = (await createCustomer(cfg, who)).id
    card = await createCard(cfg, customerId, input.tokenId)
  } catch (err) {
    console.error('[culqi] card failed:', err instanceof Error ? err.message : err)
    return { ok: false, ...failure(err) }
  }

  const tokens = pricing.step_tokens
  const priceCents = monthlyCents(tokens, pricing)
  let charge
  try {
    charge = await chargeCard(cfg, {
      cardId: card.id,
      amountCents: priceCents,
      currency: 'PEN',
      email: who.email,
      description: `Whasalia - plan ${tokens} creditos`,
      metadata: { workspace_id: input.workspaceId, kind: 'subscription_create' },
    })
  } catch (err) {
    console.error('[culqi] first charge failed:', err instanceof Error ? err.message : err)
    return { ok: false, ...failure(err) }
  }

  const now = new Date()
  const periodEnd = addMonth(now)
  const data = {
    provider: PROVIDER,
    customer_id: customerId,
    subscription_id: `culqi_${input.workspaceId}`,
    tokens,
    price_cents: priceCents,
    currency: 'PEN',
    status: 'active',
    current_period_end: periodEnd,
    cancel_at_period_end: false,
    overage_limit: overageLimit,
    card_id: card.id,
    card_label: cardLabel(card),
    renewing_at: null,
    last_error: null,
    updated_at: now,
  }
  await prisma.token_subscriptions.upsert({ where: { workspace_id: input.workspaceId }, create: { workspace_id: input.workspaceId, ...data }, update: data })
  await applyPaidMonth({ workspaceId: input.workspaceId, chargeId: charge.id, reason: 'subscription_create', tokens, amountCents: priceCents, periodStart: now, periodEnd })
  return { ok: true }
}

/** A new card for the plan. If the last renewal failed, it is charged right away. */
export async function updateCulqiCard(workspaceId: string, tokenId: unknown, now = new Date()): Promise<Result<{ renewed: boolean }>> {
  const cfg = culqiConfig()
  if (!cfg) return { ok: false, error: 'gateway_not_configured' }
  if (typeof tokenId !== 'string') return { ok: false, error: 'invalid_token' }
  const row = await prisma.token_subscriptions.findUnique({ where: { workspace_id: workspaceId } })
  if (!row || row.provider !== PROVIDER || !ACTIVE.has(row.status)) return { ok: false, error: 'not_subscribed' }
  let card
  try {
    card = await createCard(cfg, row.customer_id, tokenId)
  } catch (err) {
    return { ok: false, ...failure(err) }
  }
  await prisma.token_subscriptions.updateMany({
    where: { workspace_id: workspaceId },
    data: { card_id: card.id, card_label: cardLabel(card), updated_at: now, ...(row.status === 'past_due' ? { renewing_at: null } : {}) },
  })
  if (row.status !== 'past_due') return { ok: true, renewed: false }
  const out = await renewOne(cfg, workspaceId, now)
  return out === 'renewed' ? { ok: true, renewed: true } : { ok: false, error: 'payment_failed', detail: null }
}

/** Cancel at the end of the month (the extra credits used are charged then), or undo it. */
export async function setCulqiCancel(workspaceId: string, cancel: boolean): Promise<Result> {
  const done = await prisma.token_subscriptions.updateMany({
    where: { workspace_id: workspaceId, provider: PROVIDER, status: { in: [...ACTIVE] } },
    data: { cancel_at_period_end: cancel, updated_at: new Date() },
  })
  return done.count ? { ok: true } : { ok: false, error: 'not_subscribed' }
}

const NOTICE = {
  es: {
    failed: (date: string) => ({
      title: 'No pudimos cobrar tu plan',
      body: `Tu tarjeta rechazó el cobro del plan. Lo intentaremos de nuevo cada día; actualiza tu tarjeta en Configuración → Tokens antes del ${date} para no perder el plan.`,
    }),
    ended: () => ({ title: 'Tu plan terminó', body: 'No pudimos cobrar el plan y volviste al plan gratis (1 cuenta por servicio). Suscríbete de nuevo cuando quieras.' }),
  },
  en: {
    failed: (date: string) => ({
      title: "We couldn't charge your plan",
      body: `Your card declined the plan's charge. We'll retry every day; update your card in Settings → Tokens before ${date} to keep the plan.`,
    }),
    ended: () => ({ title: 'Your plan ended', body: "We couldn't charge the plan and you're back on the free plan (1 account per service). Subscribe again anytime." }),
  },
}

async function notify(workspaceId: string, kind: 'failed' | 'ended', graceEnd: Date) {
  const [ws, admins] = await Promise.all([
    prisma.workspaces.findUnique({ where: { id: workspaceId }, select: { locale: true } }),
    prisma.workspace_members.findMany({ where: { workspace_id: workspaceId, status: 'active', role: { in: ['owner', 'admin'] } }, select: { user_id: true } }),
  ])
  if (!admins.length) return
  const lang = ws?.locale === 'en' ? 'en' : 'es'
  const date = new Intl.DateTimeFormat(lang === 'en' ? 'en-US' : 'es-PE', { dateStyle: 'long', timeZone: 'America/Lima' }).format(graceEnd)
  const text = NOTICE[lang][kind](date)
  await prisma.notifications.createMany({
    data: admins.map((a) => ({ workspace_id: workspaceId, user_id: a.user_id, type: 'billing', title: text.title, body: text.body, link: BILLING_LINK })),
  })
}

/**
 * Renews one plan whose month ended: closes the extra credits, charges plan +
 * extra in one charge and starts the next month; or, when it was canceled,
 * charges only the extra and ends it. Returns what happened.
 */
async function renewOne(cfg: CulqiConfig, workspaceId: string, now: Date): Promise<'renewed' | 'ended' | 'failed' | 'skipped'> {
  // Claim it: two cron runs (or a card update) never charge twice; a failure waits RETRY_MS.
  const claimed = await prisma.token_subscriptions.updateMany({
    where: { workspace_id: workspaceId, provider: PROVIDER, OR: [{ renewing_at: null }, { renewing_at: { lt: new Date(now.getTime() - RETRY_MS) } }] },
    data: { renewing_at: now },
  })
  if (!claimed.count) return 'skipped'
  const row = await prisma.token_subscriptions.findUniqueOrThrow({ where: { workspace_id: workspaceId } })
  if (!row.current_period_end || !row.card_id || !ACTIVE.has(row.status)) return 'skipped'
  const periodEnd = new Date(row.current_period_end)
  if (periodEnd.getTime() > now.getTime()) {
    await prisma.token_subscriptions.updateMany({ where: { workspace_id: workspaceId }, data: { renewing_at: null } })
    return 'skipped'
  }

  // The extra credits of the month(s) that ended, not charged yet.
  await closeOverage(workspaceId, { now, includeCurrent: row.cancel_at_period_end })
  const pending = await prisma.subscription_overage_periods.findMany({
    where: { workspace_id: workspaceId, invoice_id: null, amount_cents: { gt: 0 } },
    select: { period_end: true, credits_used: true, amount_cents: true },
  })
  const extraCents = pending.reduce((s, p) => s + p.amount_cents, 0)
  const extraCredits = pending.reduce((s, p) => s + p.credits_used, 0)
  const planCents = row.cancel_at_period_end ? 0 : row.price_cents
  const total = planCents + extraCents
  const email = (await payer(workspaceId))?.email ?? 'facturacion@whasalia.com'

  let chargeId: string | null = null
  if (total > 0) {
    try {
      const charge = await chargeCard(cfg, {
        cardId: row.card_id,
        amountCents: total,
        currency: 'PEN',
        email,
        description: planCents ? `Whasalia - plan${extraCredits ? ` + ${extraCredits} creditos adicionales` : ''}` : `Whasalia - ${extraCredits} creditos adicionales`,
        metadata: { workspace_id: workspaceId, kind: planCents ? 'subscription_cycle' : 'final', extra_credits: String(extraCredits) },
      })
      chargeId = charge.id
    } catch (err) {
      const graceEnd = new Date(periodEnd.getTime() + GRACE_MS)
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[culqi] renewal for ${workspaceId} failed:`, msg)
      const over = now.getTime() >= graceEnd.getTime()
      // Canceled plans don't get retries for the extra: they end now.
      const ends = over || row.cancel_at_period_end
      await prisma.token_subscriptions.updateMany({
        where: { workspace_id: workspaceId },
        data: { status: ends ? 'canceled' : 'past_due', last_error: msg.slice(0, 300), updated_at: now, ...(ends ? { renewing_at: null } : {}) },
      })
      if (ends && !row.cancel_at_period_end) await notify(workspaceId, 'ended', graceEnd).catch(() => {})
      else if (row.status !== 'past_due' && !ends) await notify(workspaceId, 'failed', graceEnd).catch(() => {})
      return ends ? 'ended' : 'failed'
    }
    if (pending.length) {
      await prisma.subscription_overage_periods.updateMany({
        where: { workspace_id: workspaceId, period_end: { in: pending.map((p) => p.period_end) } },
        data: { invoice_id: chargeId },
      })
    }
  }

  if (row.cancel_at_period_end) {
    if (chargeId) {
      await prisma.subscription_invoices.create({
        data: { invoice_id: chargeId, workspace_id: workspaceId, reason: 'final', tokens: 0, amount_cents: total, currency: 'PEN', period_start: periodEnd, period_end: periodEnd },
      })
    }
    await prisma.token_subscriptions.updateMany({ where: { workspace_id: workspaceId }, data: { status: 'canceled', renewing_at: null, last_error: null, updated_at: now } })
    return 'ended'
  }

  const nextEnd = addMonth(periodEnd)
  await prisma.token_subscriptions.updateMany({
    where: { workspace_id: workspaceId },
    data: { status: 'active', current_period_end: nextEnd, renewing_at: null, last_error: null, updated_at: now },
  })
  await applyPaidMonth({ workspaceId, chargeId: chargeId!, reason: 'subscription_cycle', tokens: row.tokens, amountCents: total, periodStart: periodEnd, periodEnd: nextEnd })
  return 'renewed'
}

/** Billing cron: every Culqi plan whose month ended. */
export async function renewCulqiSubscriptions(now = new Date()): Promise<Record<string, number>> {
  const cfg = culqiConfig()
  const out: Record<string, number> = { renewed: 0, ended: 0, failed: 0, skipped: 0 }
  if (!cfg) return out
  const due = await prisma.token_subscriptions.findMany({
    where: { provider: PROVIDER, status: { in: [...ACTIVE] }, current_period_end: { lte: now } },
    select: { workspace_id: true },
    take: 50,
  })
  for (const { workspace_id } of due) {
    try {
      out[await renewOne(cfg, workspace_id, now)] += 1
    } catch (err) {
      // The claim stays: a charge may have gone through, so it is not retried before RETRY_MS (check Culqi's panel).
      console.error(`[culqi] renewal for ${workspace_id} crashed:`, err instanceof Error ? err.message : err)
    }
  }
  return out
}

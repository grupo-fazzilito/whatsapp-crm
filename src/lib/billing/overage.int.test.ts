// Extra credits for subscribers, against a real PostgreSQL; Stripe faked on fetch.
//   TEST_DATABASE_URL=postgresql://crm:crm@127.0.0.1:5434/crm npx vitest run src/lib/billing
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { pgTest } from '@/lib/test-utils/pg'

vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }))

const pg = await pgTest()

const stripe: { path: string; body: string; key: string | null }[] = []

describe.skipIf(!pg)('extra credits (prorated overage)', async () => {
  if (!pg) return
  const { prisma, workspace, cleanup } = pg
  process.env.STRIPE_SECRET_KEY = 'sk_test_overage'
  const realFetch = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (!href.startsWith('https://api.stripe.com/')) return realFetch(input, init)
    const path = new URL(href).pathname
    stripe.push({ path, body: String(init?.body ?? ''), key: new Headers(init?.headers).get('idempotency-key') })
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } })
    if (path === '/v1/invoiceitems') return json({ id: `ii_${stripe.length}`, invoice: new URLSearchParams(String(init?.body)).get('invoice') })
    if (path === '/v1/invoices') return json({ id: 'in_final' })
    return json({})
  })

  const credits = await import('./credits')
  const overage = await import('./overage')
  let ws: Awaited<ReturnType<typeof workspace>>
  const periodEnd = new Date(Date.now() + 20 * 86_400_000)

  const zero = async () => {
    const left = await credits.creditBalance(ws.workspaceId)
    if (left > 0) await credits.spendCredits({ workspaceId: ws.workspaceId, amount: left, action: 'adjustment' })
  }

  beforeAll(async () => {
    ws = await workspace({ name: 'Overage' })
    await zero()
    await prisma.token_subscriptions.create({
      data: {
        workspace_id: ws.workspaceId,
        customer_id: 'cus_overage',
        subscription_id: `sub_overage_${ws.workspaceId}`,
        tokens: 1000,
        price_cents: 990,
        status: 'active',
        current_period_end: periodEnd,
        overage_limit: 2000,
      },
    })
  })
  beforeEach(() => {
    stripe.length = 0
  })
  afterAll(async () => {
    vi.restoreAllMocks()
    await cleanup(ws)
    await prisma.$disconnect()
  })

  it('a subscriber out of credits keeps going with extra credits, up to its limit', async () => {
    expect(await credits.canSpend(ws.workspaceId, 'reply')).toBe(true)
    expect(await credits.creditBalance(ws.workspaceId)).toBe(1000) // one lot of 1,000 handed out
    // Use 1,150 extra credits in all: the second lot is only the 1,000 left under the 2,000 limit.
    await credits.spendCredits({ workspaceId: ws.workspaceId, amount: 1000, action: 'reply' })
    expect(await credits.spend(ws.workspaceId, 'reply', { times: 150 })).toBe(850)
    expect(await overage.overageUsage(ws.workspaceId)).toMatchObject({ limit: 2000, credits: 1150, cents: 345 }) // 1,150 × US$ 3 / 1,000
    // Nothing is billed while the month is open.
    expect(stripe).toHaveLength(0)

    await credits.spendCredits({ workspaceId: ws.workspaceId, amount: 850, action: 'reply' })
    expect(await credits.canSpend(ws.workspaceId, 'reply')).toBe(false) // at the 2,000 limit: paused
    const n = await prisma.notifications.count({ where: { workspace_id: ws.workspaceId, title: 'Estás usando créditos adicionales' } })
    expect(n).toBeGreaterThan(0)
  })

  it('a higher limit lets the AI continue the same month', async () => {
    await prisma.token_subscriptions.update({ where: { workspace_id: ws.workspaceId }, data: { overage_limit: 3000 } })
    expect(await credits.canSpend(ws.workspaceId, 'reply')).toBe(true)
    await credits.spendCredits({ workspaceId: ws.workspaceId, amount: 100, action: 'reply' })
    expect(await overage.overageUsage(ws.workspaceId)).toMatchObject({ credits: 2100, cents: 630 })
  })

  it('the renewal draft carries only what was used, prorated, once; the rest expires', async () => {
    const now = new Date(periodEnd.getTime() + 60_000)
    expect(await overage.closeOverage(ws.workspaceId, { invoiceId: 'in_renewal', now })).toBe(630)
    expect(await overage.closeOverage(ws.workspaceId, { invoiceId: 'in_renewal', now })).toBe(0) // repeated webhook
    expect(stripe).toHaveLength(1)
    const body = new URLSearchParams(stripe[0].body)
    expect(stripe[0].path).toBe('/v1/invoiceitems')
    expect(body.get('invoice')).toBe('in_renewal')
    expect(body.get('amount')).toBe('630')
    expect(body.get('customer')).toBe('cus_overage')
    expect(body.get('description')).toMatch(/2[.,]100 créditos adicionales/)
    // The 900 unused extra credits are gone, not billed.
    expect(await credits.creditBalance(ws.workspaceId)).toBe(0)
    const period = await prisma.subscription_overage_periods.findFirstOrThrow({ where: { workspace_id: ws.workspaceId } })
    expect(period).toMatchObject({ credits_used: 2100, amount_cents: 630, invoice_id: 'in_renewal', invoice_item_id: 'ii_1' })
    const invoices = await overage.subscriptionInvoices(ws.workspaceId)
    expect(invoices).toEqual([])
  })

  it('without a subscription there are no extra credits', async () => {
    await prisma.token_subscriptions.update({ where: { workspace_id: ws.workspaceId }, data: { status: 'canceled' } })
    expect(await credits.canSpend(ws.workspaceId, 'reply')).toBe(false)
    expect(await overage.overageRoom(ws.workspaceId)).toBe(false)
  })
})

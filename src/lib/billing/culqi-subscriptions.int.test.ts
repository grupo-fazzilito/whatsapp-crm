// The credit plan charged with Culqi (Peru, soles), against a real
// PostgreSQL; Culqi's API faked on fetch.
//   TEST_DATABASE_URL=postgresql://crm:crm@127.0.0.1:5434/crm npx vitest run src/lib/billing
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { pgTest } from '@/lib/test-utils/pg'

vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }))

const pg = await pgTest()

const culqi: { path: string; body: Record<string, unknown> | null }[] = []
const fake = { decline: false, review: false }
let seq = 0

describe.skipIf(!pg)('Culqi plan (soles)', async () => {
  if (!pg) return
  const { prisma, workspace, cleanup } = pg
  process.env.CULQI_PUBLIC_KEY = 'pk_test_x'
  process.env.CULQI_SECRET_KEY = 'sk_test_x'
  const realFetch = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (!href.startsWith('https://api.culqi.com/')) return realFetch(input, init)
    const path = new URL(href).pathname
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null
    culqi.push({ path, body })
    const json = (b: unknown, status = 201) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } })
    if (path === '/v2/customers' && init?.method === 'GET') return json({ data: [] }, 200)
    if (path === '/v2/customers') return json({ object: 'customer', id: 'cus_test_1' })
    if (path === '/v2/cards') return json({ object: 'card', id: `crd_test_${++seq}`, source: { last_four: '1111', iin: { card_brand: 'Visa' } } })
    if (path === '/v2/charges') {
      // The bank wants 3D Secure until the charge carries its result.
      if (fake.review && !body?.authentication_3DS) return json({ user_message: 'El usuario necesita autenticarse', action_code: 'REVIEW' }, 200)
      if (fake.decline)
        return json({ object: 'error', type: 'card_error', code: 'card_declined', decline_code: 'insufficient_funds', merchant_message: 'Fondos insuficientes', user_message: 'Tu tarjeta no tiene fondos suficientes.' }, 402)
      return json({ object: 'charge', id: `chr_test_${++seq}`, amount: body?.amount, currency_code: body?.currency_code, paid: true, outcome: { type: 'venta_exitosa' } })
    }
    return json({}, 404)
  })

  const credits = await import('./credits')
  const subs = await import('./culqi-subscriptions')
  const { hasActiveSubscription } = await import('./subscriptions')
  const { overageUsage, subscriptionInvoices } = await import('./overage')
  let ws: Awaited<ReturnType<typeof workspace>>
  const charges = () => culqi.filter((c) => c.path === '/v2/charges')
  const row = () => prisma.token_subscriptions.findUniqueOrThrow({ where: { workspace_id: ws.workspaceId } })

  beforeAll(async () => {
    ws = await workspace({ name: 'Culqi' })
    const left = await credits.creditBalance(ws.workspaceId)
    if (left > 0) await credits.spendCredits({ workspaceId: ws.workspaceId, amount: left, action: 'adjustment' })
  })
  beforeEach(() => {
    culqi.length = 0
    fake.decline = false
    fake.review = false
  })
  afterAll(async () => {
    vi.restoreAllMocks()
    await cleanup(ws)
    await prisma.$disconnect()
  })

  it('needs the billing details before saving a card', async () => {
    expect(await subs.subscribeCulqi({ workspaceId: ws.workspaceId, tokenId: 'tkn_test_abc' })).toMatchObject({ ok: false, error: 'billing_profile_incomplete' })
    expect(culqi).toHaveLength(0)
  })

  it('subscribing saves the card, charges S/ 39.90 and gives 1,000 credits', async () => {
    const details = { doc_type: 1, doc_number: '12345678', legal_name: 'Ana Pérez', email: 'ana@example.com', address: 'Av. Larco 123', city: 'Lima', phone: '987654321' }
    await prisma.billing_accounts.upsert({ where: { workspace_id: ws.workspaceId }, create: { workspace_id: ws.workspaceId, ...details }, update: details })
    expect(await subs.subscribeCulqi({ workspaceId: ws.workspaceId, tokenId: 'tkn_test_abc', overageLimit: 2000 })).toEqual({ ok: true })
    // Customer (looked up by email, then created), the token charged, then saved as the card.
    expect(culqi.map((c) => c.path)).toEqual(['/v2/customers', '/v2/customers', '/v2/charges', '/v2/cards'])
    expect(culqi[1].body).toMatchObject({ first_name: 'Ana', last_name: 'Pérez', country_code: 'PE', phone_number: '987654321' })
    expect(charges()[0].body).toMatchObject({ amount: 3990, currency_code: 'PEN', source_id: 'tkn_test_abc', email: 'ana@example.com', antifraud_details: { first_name: 'Ana', phone_number: '987654321' } })
    expect(culqi[3].body).toMatchObject({ token_id: 'tkn_test_abc' })
    expect(await row()).toMatchObject({ provider: 'culqi', status: 'active', currency: 'PEN', price_cents: 3990, overage_limit: 2000, card_label: 'Visa •••• 1111' })
    expect(await credits.creditBalance(ws.workspaceId)).toBe(1000)
    expect(await hasActiveSubscription(ws.workspaceId)).toBe(true)
    expect(await subs.subscribeCulqi({ workspaceId: ws.workspaceId, tokenId: 'tkn_test_abc' })).toMatchObject({ ok: false, error: 'already_subscribed' })
  })

  it('the month after: plan + extra credits used (S/ 14.90 per 1,000, prorated) in one charge', async () => {
    await credits.spendCredits({ workspaceId: ws.workspaceId, amount: 1000, action: 'reply' })
    expect(await credits.spend(ws.workspaceId, 'reply', { times: 100 })).toBe(900) // extra credits handed out
    expect(await overageUsage(ws.workspaceId)).toMatchObject({ credits: 100, cents: 149 })
    const end = new Date((await row()).current_period_end!)

    // Nothing to do before the month ends.
    expect(await subs.renewCulqiSubscriptions(new Date(end.getTime() - 60_000))).toMatchObject({ renewed: 0 })
    const after = new Date(end.getTime() + 60_000)
    expect(await subs.renewCulqiSubscriptions(after)).toMatchObject({ renewed: 1 })
    expect(await subs.renewCulqiSubscriptions(after)).toMatchObject({ renewed: 0 }) // once
    expect(charges()).toHaveLength(1)
    expect(charges()[0].body).toMatchObject({ amount: 3990 + 149, currency_code: 'PEN' })
    expect(String(charges()[0].body?.description)).toContain('100 creditos adicionales')
    const r = await row()
    expect(r.status).toBe('active')
    expect(new Date(r.current_period_end!).getTime()).toBeGreaterThan(end.getTime() + 27 * 86_400_000)
    // The new month: 1,000 fresh credits, last month's leftovers gone.
    expect(await credits.creditBalance(ws.workspaceId)).toBe(1000)
    const invoices = await subscriptionInvoices(ws.workspaceId)
    expect(invoices[0]).toMatchObject({ amount_cents: 4139, currency: 'PEN', credits: 1000, overage_credits: 100, overage_cents: 149 })
  })

  it('a declined renewal: past due, retried daily, a new card charges it; after the grace days the plan ends', async () => {
    const end = new Date((await row()).current_period_end!)
    fake.decline = true
    expect(await subs.renewCulqiSubscriptions(new Date(end.getTime() + 60_000))).toMatchObject({ failed: 1 })
    expect(await row()).toMatchObject({ status: 'past_due', last_error: 'Fondos insuficientes' })
    expect(await subs.renewCulqiSubscriptions(new Date(end.getTime() + 3_600_000))).toMatchObject({ skipped: 1 }) // waits a day

    fake.decline = false
    expect(await subs.updateCulqiCard(ws.workspaceId, 'tkn_test_new', new Date(end.getTime() + 7_200_000))).toEqual({ ok: true, renewed: true })
    expect(await row()).toMatchObject({ status: 'active', last_error: null })
    // Paid with the new token, which then became the plan's card.
    expect(charges().at(-1)?.body).toMatchObject({ source_id: 'tkn_test_new' })
    expect(culqi.at(-1)).toMatchObject({ path: '/v2/cards', body: { token_id: 'tkn_test_new' } })

    // Next month, declined until the grace ends.
    const end2 = new Date((await row()).current_period_end!)
    fake.decline = true
    expect(await subs.renewCulqiSubscriptions(new Date(end2.getTime() + 60_000))).toMatchObject({ failed: 1 })
    expect(await subs.renewCulqiSubscriptions(new Date(end2.getTime() + 4 * 86_400_000))).toMatchObject({ ended: 1 })
    expect((await row()).status).toBe('canceled')
    expect(await hasActiveSubscription(ws.workspaceId, new Date(end2.getTime() + 4 * 86_400_000))).toBe(false)
    const notes = await prisma.notifications.findMany({ where: { workspace_id: ws.workspaceId, title: { in: ['No pudimos cobrar tu plan', 'Tu plan terminó'] } } })
    expect(notes.length).toBeGreaterThanOrEqual(2)
  })

  it('cancel: active until the month ends, then only the extra credits are charged', async () => {
    fake.decline = false
    await prisma.token_subscriptions.update({ where: { workspace_id: ws.workspaceId }, data: { status: 'canceled' } })
    // Earlier months of this test run may share the second the new month ends on.
    await prisma.subscription_overage_periods.deleteMany({ where: { workspace_id: ws.workspaceId } })
    await prisma.subscription_overage_grants.deleteMany({ where: { workspace_id: ws.workspaceId } })
    expect(await subs.subscribeCulqi({ workspaceId: ws.workspaceId, tokenId: 'tkn_test_again' })).toEqual({ ok: true })
    expect(culqi.filter((c) => c.path === '/v2/customers')).toHaveLength(0) // same Culqi customer
    expect(await subs.setCulqiCancel(ws.workspaceId, true)).toEqual({ ok: true })
    await credits.spendCredits({ workspaceId: ws.workspaceId, amount: await credits.creditBalance(ws.workspaceId), action: 'reply' })
    expect(await credits.spend(ws.workspaceId, 'reply', { times: 10 })).toBeGreaterThan(0)
    culqi.length = 0
    const end = new Date((await row()).current_period_end!)
    expect(await subs.renewCulqiSubscriptions(new Date(end.getTime() + 60_000))).toMatchObject({ ended: 1 })
    expect(charges()).toHaveLength(1)
    expect(charges()[0].body).toMatchObject({ amount: 15, currency_code: 'PEN' }) // 10 × S/ 14.90 / 1,000 = S/ 0.149 → 15 céntimos
    expect((await row()).status).toBe('canceled')
  })

  it('3D Secure when subscribing: needs_3ds with the amount, then the same token with the bank result', async () => {
    await prisma.token_subscriptions.update({ where: { workspace_id: ws.workspaceId }, data: { status: 'canceled' } })
    fake.review = true
    const first = await subs.subscribeCulqi({ workspaceId: ws.workspaceId, tokenId: 'tkn_test_3ds', deviceId: 'b7c1a9e2-1111-4222-8333-444455556666' })
    expect(first).toEqual({ ok: false, error: 'needs_3ds', amountCents: 3990 })
    expect(culqi.filter((c) => c.path === '/v2/cards')).toHaveLength(0) // nothing saved yet
    expect((await row()).status).toBe('canceled')

    const auth = { eci: '05', xid: 'eGlk', cavv: 'Y2F2dg==', protocolVersion: '2.1.0', directoryServerTransactionId: 'ds-1' }
    expect(await subs.subscribeCulqi({ workspaceId: ws.workspaceId, tokenId: 'tkn_test_3ds', deviceId: 'b7c1a9e2-1111-4222-8333-444455556666', authentication3DS: auth })).toEqual({ ok: true })
    const last = charges().at(-1)!.body!
    expect(last).toMatchObject({ source_id: 'tkn_test_3ds', authentication_3DS: auth, antifraud_details: { device_finger_print_id: 'b7c1a9e2-1111-4222-8333-444455556666' } })
    expect(await row()).toMatchObject({ status: 'active', card_label: 'Visa •••• 1111' })
  })

  it('3D Secure on a renewal: past due with the reason; "Pay now" authenticates and pays it', async () => {
    const end = new Date((await row()).current_period_end!)
    fake.review = true
    expect(await subs.renewCulqiSubscriptions(new Date(end.getTime() + 60_000))).toMatchObject({ failed: 1 })
    expect((await row()).status).toBe('past_due')
    expect((await row()).last_error).toContain('3D Secure')

    const at = new Date(end.getTime() + 3_600_000)
    expect(await subs.updateCulqiCard(ws.workspaceId, 'tkn_test_pay', at)).toMatchObject({ ok: false, error: 'needs_3ds', amountCents: 3990 })
    expect((await row()).status).toBe('past_due') // nothing changed meanwhile
    const auth = { eci: '05', cavv: 'Y2F2dg==', protocolVersion: '2.1.0' }
    expect(await subs.updateCulqiCard(ws.workspaceId, 'tkn_test_pay', at, { authentication3DS: auth })).toEqual({ ok: true, renewed: true })
    expect(await row()).toMatchObject({ status: 'active', last_error: null })
    expect(new Date((await row()).current_period_end!).getTime()).toBeGreaterThan(end.getTime())
  })
})

// Credit flow through the raw-SQL wrappers, against a real PostgreSQL:
//   TEST_DATABASE_URL=postgresql://crm:crm@127.0.0.1:5434/crm npx vitest run src/lib/billing
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { pgTest } from '@/lib/test-utils/pg'

vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }))

const pg = await pgTest()

describe.skipIf(!pg)('billing credits on PostgreSQL', async () => {
  if (!pg) return
  const { prisma, workspace, cleanup } = pg
  process.env.ENCRYPTION_KEY ||= 'test-encryption-key-for-int-tests'
  const credits = await import('./credits')
  const payments = await import('./payments')
  const { listMemberships } = await import('@/lib/workspace/context')
  const invitations = await import('@/lib/workspace/invitations')
  let a: Awaited<ReturnType<typeof workspace>>
  let b: Awaited<ReturnType<typeof workspace>>

  beforeAll(async () => {
    a = await workspace({ name: 'Credits A' })
    b = await workspace({ name: 'Credits B' })
  })
  afterAll(async () => {
    await cleanup(a, b)
    await prisma.$disconnect()
  })

  it('balance, grant and spend go through the SQL functions', async () => {
    const start = await credits.creditBalance(a.workspaceId)
    expect(typeof start).toBe('number')

    const lot = await credits.grantCredits({ workspaceId: a.workspaceId, amount: 50, source: 'grant', expiresAt: new Date(Date.now() + 86_400_000), note: 'test', actorId: a.userId })
    expect(lot).toMatch(/^[0-9a-f-]{36}$/)
    expect(await credits.creditBalance(a.workspaceId)).toBe(start + 50)

    const left = await credits.spendCredits({ workspaceId: a.workspaceId, amount: 30, action: 'adjustment', note: 'deduct', actorId: a.userId })
    expect(left).toBe(start + 20)
    expect(await credits.spendCredits({ workspaceId: a.workspaceId, amount: 1_000_000, action: 'reply', partial: false })).toBe(-1)

    const ledger = await a.db.credit_ledger.findMany({ orderBy: { id: 'desc' }, take: 2 })
    expect(ledger.map((l) => [l.kind, l.credits])).toEqual([['adjustment', -30], ['grant', 50]])
    // Other workspace untouched.
    expect(await b.db.credit_ledger.count({ where: { kind: 'adjustment' } })).toBe(0)
  })

  it('spend() charges an action and reports the balance after', async () => {
    const before = await credits.creditBalance(a.workspaceId)
    const left = await credits.spend(a.workspaceId, 'reply')
    expect(left).not.toBeNull()
    expect(left).toBeLessThan(before)
    expect(await credits.creditBalance(a.workspaceId)).toBe(left)
  })

  it('notifyBilling claims the low mark once and notifies owners', async () => {
    await credits.notifyBilling(a.workspaceId, 'low', 3)
    await credits.notifyBilling(a.workspaceId, 'low', 3)
    const notes = await a.db.notifications.findMany({ where: { type: 'billing' } })
    expect(notes).toHaveLength(1)
    expect(notes[0].user_id).toBe(a.userId)
    expect(notes[0].link).toBe(credits.BILLING_LINK)
    const acct = await a.db.billing_accounts.findFirst({ where: { workspace_id: a.workspaceId } })
    expect(typeof acct?.low_notified_at).toBe('string')
    // A grant re-arms the mark (grant_credits).
    await credits.grantCredits({ workspaceId: a.workspaceId, amount: 1, source: 'grant', expiresAt: new Date(Date.now() + 86_400_000) })
    expect((await a.db.billing_accounts.findFirst({ where: { workspace_id: a.workspaceId } }))?.low_notified_at).toBeNull()
  })

  it('applies and reverses a paid top-up (apply_billing_payment / EXTORNO webhook)', async () => {
    const pay = await a.db.billing_payments.create({
      data: { workspace_id: a.workspaceId, amount: 10, credits: 200, unit_price: 0.05, status: 'pending', provider_order_id: `T-${Date.now()}` },
    })
    const before = await credits.creditBalance(a.workspaceId)
    const [{ v }] = await prisma.$queryRaw<{ v: boolean }[]>`SELECT public.apply_billing_payment(${pay.id}::uuid, 6) AS v`
    expect(v).toBe(true)
    expect(await credits.creditBalance(a.workspaceId)).toBe(before + 200)

    expect(await payments.handlePayinWebhook(pay.id, 'wrong-token', {})).toBe('unauthorized')
    const r = await payments.handlePayinWebhook(pay.id, payments.webhookToken(pay.id), { OrdenID: pay.provider_order_id, Estado: 'EXTORNO' })
    expect(r).toBe('ok')
    expect(await credits.creditBalance(a.workspaceId)).toBe(before)
    expect((await a.db.billing_payments.findFirst({ where: { id: pay.id } }))?.status).toBe('reversed')
    // syncPayment returns settled payments as they are.
    expect((await payments.syncPayment(pay.id))?.status).toBe('reversed')
  })

  it('billing cron runs expire_credit_lots', async () => {
    const r = await payments.runBillingCron()
    expect(typeof r.checked).toBe('number')
    expect(typeof r.expiredLots).toBe('number')
  })

  it('memberships and invitations', async () => {
    const mine = await listMemberships(a.userId)
    expect(mine.map((m) => [m.role, m.workspace.id])).toEqual([['owner', a.workspaceId]])
    expect(typeof mine[0].workspace.created_at).toBe('string')

    const { token, hash } = invitations.newInviteToken()
    await a.db.workspace_invitations.create({ data: { workspace_id: a.workspaceId, email: b.email, role: 'agent', token_hash: hash } })
    const inv = await invitations.findPendingInvitation(token)
    expect(inv).toMatchObject({ workspace_id: a.workspaceId, email: b.email, role: 'agent', workspace_name: 'Credits A' })
    await invitations.acceptInvitation(inv!, b.userId)
    await invitations.acceptInvitation(inv!, b.userId) // idempotent
    expect(await invitations.findPendingInvitation(token)).toBeNull()
    const theirs = await listMemberships(b.userId)
    expect(theirs.map((m) => m.workspace.id).sort()).toEqual([a.workspaceId, b.workspaceId].sort())
  })
})

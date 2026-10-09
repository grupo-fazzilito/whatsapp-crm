// Runs against a real PostgreSQL with the baseline schema:
//   TEST_DATABASE_URL=postgresql://crm:crm@127.0.0.1:5434/crm npx vitest run src/lib/db
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const url = process.env.TEST_DATABASE_URL

describe.skipIf(!url)('tenantDb on PostgreSQL', async () => {
  if (url) process.env.DATABASE_URL = url
  const { prisma } = await import('./prisma')
  const { tenantDb } = await import('./tenant')
  let wsA = ''
  let wsB = ''
  const emails = [`a-${Date.now()}@int.test`, `b-${Date.now()}@int.test`]

  beforeAll(async () => {
    for (const [i, email] of emails.entries()) {
      await prisma.users.create({ data: { email, meta: { full_name: `U${i}`, business_name: `Biz ${i}`, business_type: 'store' } } })
    }
    const members = await prisma.workspace_members.findMany({ where: { users: { email: { in: emails } } }, include: { users: true } })
    wsA = members.find((m) => m.users.email === emails[0])!.workspace_id
    wsB = members.find((m) => m.users.email === emails[1])!.workspace_id
  })
  afterAll(async () => {
    await prisma.workspaces.deleteMany({ where: { id: { in: [wsA, wsB] } } })
    await prisma.users.deleteMany({ where: { email: { in: emails } } })
    await prisma.$disconnect()
  })

  it('signup trigger created one workspace per user', () => {
    expect(wsA).toBeTruthy()
    expect(wsB).toBeTruthy()
    expect(wsA).not.toBe(wsB)
  })

  it('each tenant client only sees and writes its own rows', async () => {
    const a = tenantDb(wsA)
    const b = tenantDb(wsB)
    const tag = await a.tags.create({ data: { name: 'vip', color: '#000' } })
    expect(tag.workspace_id).toBe(wsA)
    expect(await b.tags.findMany()).toHaveLength(0)
    expect(await b.tags.findUnique({ where: { id: tag.id } })).toBeNull()
    expect((await b.tags.updateMany({ where: { id: tag.id }, data: { name: 'hack' } })).count).toBe(0)
    expect((await b.tags.deleteMany({ where: { id: tag.id } })).count).toBe(0)
    expect((await a.tags.findUnique({ where: { id: tag.id } }))?.name).toBe('vip')
    await expect(b.tags.update({ where: { id: tag.id }, data: { name: 'hack' } })).rejects.toThrow()
    expect(await a.workspaces.findUnique({ where: { id: wsA } })).not.toBeNull()
    await expect(a.workspaces.findUnique({ where: { id: wsB } })).rejects.toThrow(/current workspace/)
  })

  it('rows come back like PostgREST rows (ISO strings, numbers)', async () => {
    const lot = await tenantDb(wsA).credit_lots.findFirst({ include: { credit_ledger: true } })
    expect(typeof lot?.expires_at).toBe('string')
    expect(lot?.expires_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(typeof lot?.credit_ledger[0].id).toBe('number')
    expect(typeof lot?.credit_ledger[0].created_at).toBe('string')
    const pay = await tenantDb(wsA).billing_payments.create({ data: { workspace_id: wsA, amount: 50, credits: 1000, unit_price: 0.05, expires_on: '2026-10-11' } })
    expect(pay.amount).toBe(50)
    expect(pay.expires_on).toBe('2026-10-11')
    const found = await tenantDb(wsA).billing_payments.findMany({ where: { expires_on: { gte: '2026-10-01' } } })
    expect(found.map((p) => p.id)).toEqual([pay.id])
  })

  it('credit functions work through raw SQL', async () => {
    const [{ credit_balance }] = await prisma.$queryRaw<{ credit_balance: number }[]>`SELECT public.credit_balance(${wsA}::uuid)`
    expect(credit_balance).toBe(100)
  })
})

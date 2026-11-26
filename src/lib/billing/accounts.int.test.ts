// Free plan: one connected account per service, against a real PostgreSQL.
//   TEST_DATABASE_URL=postgresql://crm:crm@127.0.0.1:5434/crm npx vitest run src/lib/billing
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { pgTest } from '@/lib/test-utils/pg'

vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }))

const pg = await pgTest()

describe.skipIf(!pg)('free plan: 1 account per service', async () => {
  if (!pg) return
  const { prisma, workspace, cleanup } = pg
  const accounts = await import('./accounts')
  const { findChannelByExternalId } = await import('@/lib/channels/store')
  let ws: Awaited<ReturnType<typeof workspace>>
  const ids: Record<string, string> = {}

  const add = (key: string, type: string, daysAgo: number) =>
    prisma.channels
      .create({
        data: { workspace_id: ws.workspaceId, type, name: key, external_id: `${key}-${ws.workspaceId}`, created_at: new Date(Date.now() - daysAgo * 86_400_000) },
        select: { id: true },
      })
      .then((c) => (ids[key] = c.id))

  beforeAll(async () => {
    ws = await workspace({ name: 'Accounts' })
    await add('wa-main', 'whatsapp', 90)
    await add('ig-main', 'instagram', 80)
  })
  afterAll(async () => {
    await cleanup(ws)
    await prisma.$disconnect()
  })

  it('one per service on the free plan; unlimited with the plan or the courtesy', async () => {
    expect(await accounts.canAddChannel(ws.workspaceId, 'whatsapp')).toBe(false)
    expect(await accounts.canAddChannel(ws.workspaceId, 'messenger')).toBe(true)
    await prisma.workspaces.update({ where: { id: ws.workspaceId }, data: { unlimited_accounts: true } })
    expect(await accounts.canAddChannel(ws.workspaceId, 'whatsapp')).toBe(true)
    await prisma.workspaces.update({ where: { id: ws.workspaceId }, data: { unlimited_accounts: false } })
  })

  it('extra accounts: 30 days to subscribe, then only the main one stays', async () => {
    await add('wa-extra', 'whatsapp', 10)
    const t0 = new Date()
    expect(await accounts.enforceAccountLimits(t0)).toMatchObject({ warned: 1, disconnected: 0 })
    expect(await accounts.enforceAccountLimits(t0)).toMatchObject({ warned: 0, disconnected: 0 }) // warned once
    expect((await accounts.accountsPlan(ws.workspaceId)).disconnect_on).toBe(new Date(t0.getTime() + 30 * 86_400_000).toISOString())

    const later = new Date(t0.getTime() + 31 * 86_400_000)
    expect(await accounts.enforceAccountLimits(later)).toMatchObject({ disconnected: 1 })
    const extra = await prisma.channels.findUniqueOrThrow({ where: { id: ids['wa-extra'] } })
    expect(extra).toMatchObject({ status: 'disconnected', status_detail: 'plan_limit' })
    const main = await prisma.channels.findUniqueOrThrow({ where: { id: ids['wa-main'] } })
    expect(main.status).toBe('connected')
    // Webhooks for the disconnected account are dropped; the main one still works.
    expect(await findChannelByExternalId('whatsapp', `wa-extra-${ws.workspaceId}`)).toBeNull()
    expect(await findChannelByExternalId('whatsapp', `wa-main-${ws.workspaceId}`)).not.toBeNull()
    const notes = await prisma.notifications.count({ where: { workspace_id: ws.workspaceId, type: 'billing' } })
    expect(notes).toBeGreaterThanOrEqual(2)
  })

  it('subscribing brings the disconnected accounts back', async () => {
    await prisma.token_subscriptions.create({
      data: { workspace_id: ws.workspaceId, customer_id: 'cus_acc', subscription_id: `sub_acc_${ws.workspaceId}`, tokens: 1000, price_cents: 990, status: 'active', current_period_end: new Date(Date.now() + 20 * 86_400_000) },
    })
    expect(await accounts.enforceAccountLimits()).toMatchObject({ restored: 1 })
    const extra = await prisma.channels.findUniqueOrThrow({ where: { id: ids['wa-extra'] } })
    expect(extra.status).toBe('connected')
    expect((extra.settings as Record<string, unknown>).plan_disabled).toBeUndefined()
    expect((await prisma.workspaces.findUniqueOrThrow({ where: { id: ws.workspaceId } })).extra_accounts_since).toBeNull()
  })
})

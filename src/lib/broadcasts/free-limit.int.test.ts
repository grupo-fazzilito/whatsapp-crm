// Free plan broadcast limit against a real PostgreSQL.
//   TEST_DATABASE_URL=postgresql://crm:crm@127.0.0.1:5434/crm npx vitest run src/lib/broadcasts
import { afterAll, describe, expect, it, vi } from 'vitest'
import { pgTest } from '@/lib/test-utils/pg'

vi.mock('server-only', () => ({}))

const pg = await pgTest()

describe.skipIf(!pg)('free plan broadcast limit', async () => {
  if (!pg) return
  const { prisma, workspace, cleanup } = pg
  const { assertBroadcastQuota, broadcastQuota, BroadcastLimitError, FREE_BROADCAST_LIMIT } = await import('./free-limit')
  const ws = await workspace({ name: 'Difusiones' })
  afterAll(async () => {
    await cleanup(ws)
    await prisma.$disconnect()
  })

  const contact = await prisma.contacts.create({ data: { workspace_id: ws.workspaceId, name: 'Ana', phone: '+51911111111' } })
  const b = await prisma.broadcasts.create({ data: { workspace_id: ws.workspaceId, name: 'Promo', template_name: 't', status: 'sent', total_recipients: 3 } })
  // 2 sent + 1 failed (failed sends don't count).
  await prisma.broadcast_recipients.createMany({
    data: [
      { workspace_id: ws.workspaceId, broadcast_id: b.id, contact_id: contact.id, status: 'sent' },
      { workspace_id: ws.workspaceId, broadcast_id: b.id, contact_id: contact.id, status: 'delivered' },
      { workspace_id: ws.workspaceId, broadcast_id: b.id, contact_id: contact.id, status: 'failed' },
    ],
  })

  it('counts this month’s sends on the free plan', async () => {
    const q = await broadcastQuota(ws.workspaceId)
    expect(q).toMatchObject({ limit: FREE_BROADCAST_LIMIT, used: 2, remaining: FREE_BROADCAST_LIMIT - 2 })
    expect(new Date(q.resets_at).getTime()).toBeGreaterThan(Date.now())
  })

  it('refuses a broadcast that does not fit and lets one that fits', async () => {
    await expect(assertBroadcastQuota(ws.workspaceId, FREE_BROADCAST_LIMIT - 2)).resolves.toBeUndefined()
    await expect(assertBroadcastQuota(ws.workspaceId, FREE_BROADCAST_LIMIT - 1)).rejects.toBeInstanceOf(BroadcastLimitError)
  })

  it('has no limit on the paid plan', async () => {
    await prisma.token_subscriptions.create({
      data: { workspace_id: ws.workspaceId, provider: 'culqi', customer_id: 'cus_x', subscription_id: `sub_${ws.workspaceId}`, tokens: 1000, price_cents: 3990, currency: 'PEN', status: 'active', current_period_end: new Date(Date.now() + 86_400_000) },
    })
    expect(await broadcastQuota(ws.workspaceId)).toMatchObject({ limit: null, remaining: null })
    await expect(assertBroadcastQuota(ws.workspaceId, 50_000)).resolves.toBeUndefined()
  })
})

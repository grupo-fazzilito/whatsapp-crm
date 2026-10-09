// Dashboard order queries against a real PostgreSQL:
//   TEST_DATABASE_URL=postgresql://crm:crm@127.0.0.1:5434/crm npx vitest run src/lib/orders/list.int.test.ts
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { pgTest } from '@/lib/test-utils/pg'

vi.mock('server-only', () => ({}))

describe('orderWhere', async () => {
  const { orderWhere } = await import('./list')
  it('maps the page filters', () => {
    expect(orderWhere({})).toEqual({})
    expect(orderWhere({ status: 'bogus', paymentStatuses: ['nope'] })).toEqual({})
    expect(orderWhere({ q: '#12' })).toEqual({ AND: [{ OR: [{ number: 12 }, { customer_phone: { contains: '12', mode: 'insensitive' } }] }] })
    expect(orderWhere({ excludeCancelled: true, paymentStatuses: ['paid'], q: 'ana' })).toEqual({
      AND: [
        { status: { not: 'cancelled' } },
        { payment_status: { in: ['paid'] } },
        { OR: [{ customer_name: { contains: 'ana', mode: 'insensitive' } }, { customer_phone: { contains: 'ana', mode: 'insensitive' } }] },
      ],
    })
  })
})

const pg = await pgTest()

describe.skipIf(!pg)('orders list on PostgreSQL', async () => {
  const { listOrders, getOrderDetail, pendingOrderCount } = await import('./list')
  let a: Awaited<ReturnType<NonNullable<typeof pg>['workspace']>>
  let b: Awaited<ReturnType<NonNullable<typeof pg>['workspace']>>

  beforeAll(async () => {
    a = await pg!.workspace()
    b = await pg!.workspace()
  })
  afterAll(() => pg!.cleanup(a, b))

  it('returns PostgREST-shaped rows, detail and the pending count', async () => {
    const contact = await a.db.contacts.create({ data: { workspace_id: a.workspaceId, phone: '+51933', name: 'Caro' } })
    const o1 = await a.db.orders.create({ data: { workspace_id: a.workspaceId, contact_id: contact.id, customer_name: 'Caro', customer_phone: '+51933', total: 25.5 } })
    await a.db.orders.create({ data: { workspace_id: a.workspaceId, status: 'cancelled', customer_name: 'Otro' } })
    await b.db.orders.create({ data: { workspace_id: b.workspaceId, customer_name: 'Caro B' } })
    await a.db.order_items.create({ data: { workspace_id: a.workspaceId, order_id: o1.id, name: 'Polo', quantity: 2, unit_price: 12.75, total: 25.5 } })
    await a.db.order_events.create({ data: { workspace_id: a.workspaceId, order_id: o1.id, type: 'created' } })

    const all = await listOrders(a.db, {})
    expect(all).toHaveLength(2)
    const row = all.find((o) => o.id === o1.id)!
    expect(row).toMatchObject({ contact: { name: 'Caro', phone: '+51933' }, channel: null, order_items: [{ count: 1 }], total: 25.5 })
    expect(typeof row.number).toBe('number')
    expect(row).not.toHaveProperty('contacts')
    expect((await listOrders(a.db, { excludeCancelled: true })).map((o) => o.id)).toEqual([o1.id])
    expect((await listOrders(a.db, { q: 'caro' })).map((o) => o.id)).toEqual([o1.id])
    expect((await listOrders(a.db, { q: `#${row.number}` })).map((o) => o.id)).toEqual([o1.id])
    expect(await listOrders(a.db, { from: '2999-01-01T00:00:00Z' })).toEqual([])

    const detail = await getOrderDetail(a.db, o1.id)
    expect(detail?.items).toEqual([expect.objectContaining({ name: 'Polo', quantity: 2, unit_price: 12.75 })])
    expect(detail?.events.map((e) => e.type)).toEqual(['created'])
    expect(await getOrderDetail(b.db, o1.id)).toBeNull()
    expect(await pendingOrderCount(a.db)).toBe(1)
  })
})

// Orders, catalog search and reports on a real PostgreSQL (raw SQL functions:
// confirm_order, cancel_order, search_products, reports_*). Skipped without
// TEST_DATABASE_URL:
//   TEST_DATABASE_URL=postgresql://crm:crm@127.0.0.1:5434/crm npx vitest run src/lib/orders
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { pgTest } from '@/lib/test-utils/pg'
import type { Workspace } from '@/lib/workspace/types'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/messaging/send', () => ({ sendMessage: vi.fn() }))
vi.mock('@/lib/ai/context', () => ({ invalidateBusinessContext: vi.fn() }))

const pg = await pgTest()
// Imported only with a database: the Prisma client needs DATABASE_URL at load.
const svc = pg ? await import('./service') : null
const manual = pg ? await import('./manual') : null
const search = pg ? await import('@/lib/catalog/search') : null
const reports = pg ? await import('@/lib/reports/service') : null
const range = pg ? await import('@/lib/reports/range') : null

describe.skipIf(!pg)('orders on PostgreSQL', () => {
  let made: Awaited<ReturnType<NonNullable<typeof pg>['workspace']>>
  let ws: Workspace
  let productId = ''
  let contactId = ''

  beforeAll(async () => {
    made = await pg!.workspace()
    await pg!.prisma.workspaces.update({ where: { id: made.workspaceId }, data: { currency: 'PEN' } })
    ws = (await pg!.prisma.workspaces.findUniqueOrThrow({ where: { id: made.workspaceId } })) as unknown as Workspace
    const p = await made.db.products.create({
      data: { workspace_id: made.workspaceId, name: 'Pizza margarita', description: 'Queso y albahaca', price: 25.5, track_stock: true, stock: 5, is_active: true },
    })
    productId = p.id
    const c = await made.db.contacts.create({ data: { workspace_id: made.workspaceId, name: 'Ana', phone: '+51999000111' } })
    contactId = c.id
  })
  afterAll(async () => {
    if (made) await pg!.cleanup(made)
  })

  const stock = async () => (await made.db.products.findFirstOrThrow({ where: { id: productId }, select: { stock: true } })).stock

  it('cart → order → confirm (reserves stock) → cancel (restores it)', async () => {
    const s = svc!
    const cart = (await made.db.carts.create({
      data: { workspace_id: made.workspaceId, contact_id: contactId },
      select: { id: true, workspace_id: true, conversation_id: true, contact_id: true, checkout: true },
    })) as import('./service').Cart
    expect(await s.addToCart(cart, productId, null, 2)).toMatchObject({ ok: true, quantity: 2 })
    expect(await s.addToCart(cart, productId, null, 9)).toMatchObject({ ok: false, reason: 'not_enough', available: 5 })

    const lines = await s.cartItems(cart.id) // workspace looked up from the cart
    expect(lines).toEqual([expect.objectContaining({ productId, quantity: 2, unitPrice: 25.5, trackStock: true, available: 5 })])

    await s.saveCheckout(cart, { fulfillment: 'pickup', step: undefined })
    const settings = s.orderSettings(ws)
    const placed = await s.placeOrderFromCart({ workspace: ws, cart, channelId: null, source: 'ai', settings })
    expect(placed.ok).toBe(true)
    if (!placed.ok) return
    expect(placed.order.number).toBeGreaterThan(0)
    expect(placed.order.total).toBe(51)
    expect((await made.db.carts.findFirstOrThrow({ where: { id: cart.id } })).status).toBe('converted')
    expect(await made.db.order_items.count({ where: { order_id: placed.order.id } })).toBe(1)

    expect(await s.updateOrderStatus({ workspaceId: made.workspaceId, orderId: placed.order.id, status: 'preparing', userId: made.userId, notify: false })).toEqual({ ok: true })
    expect(await stock()).toBe(3)
    expect((await made.db.orders.findFirstOrThrow({ where: { id: placed.order.id } })).status).toBe('preparing')

    expect(await s.markOrderPaid(made.workspaceId, placed.order.id, made.userId, false)).toEqual({ ok: true })
    expect((await made.db.orders.findFirstOrThrow({ where: { id: placed.order.id } })).payment_status).toBe('paid')

    expect(await s.updateOrderStatus({ workspaceId: made.workspaceId, orderId: placed.order.id, status: 'cancelled', userId: made.userId, notify: false })).toEqual({ ok: true })
    expect(await stock()).toBe(5)
    expect(await s.updateOrderStatus({ workspaceId: made.workspaceId, orderId: placed.order.id, status: 'confirmed', userId: null, notify: false })).toEqual({ ok: false, error: 'closed' })
    expect(await s.updateOrderStatus({ workspaceId: made.workspaceId, orderId: 'nope', status: 'confirmed', userId: null })).toEqual({ ok: false, error: 'not_found' })
  })

  it('manual orders copy catalog names and prices', async () => {
    const r = await manual!.createManualOrder({ workspace: ws, userId: made.userId, contactId, items: [{ product_id: productId, quantity: 1 }, { product_id: productId, quantity: 2 }], fulfillment: 'pickup' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const order = await made.db.orders.findFirstOrThrow({ where: { id: r.order.id }, include: { order_items: true } })
    expect(order).toMatchObject({ customer_name: 'Ana', customer_phone: '+51999000111', subtotal: 76.5, created_by: made.userId })
    expect(order.order_items).toEqual([expect.objectContaining({ name: 'Pizza margarita', quantity: 3, unit_price: 25.5, total: 76.5 })])
    expect(await manual!.createManualOrder({ workspace: ws, userId: made.userId, contactId, items: [{ product_id: 'bad', quantity: 1 }], fulfillment: 'pickup' })).toEqual({ ok: false, error: 'unavailable' })
  })

  it('search_products finds by text and returns PostgREST-shaped rows', async () => {
    const rows = await search!.searchProducts(made.workspaceId, { text: 'margarita' })
    expect(rows.map((r) => r.id)).toEqual([productId])
    expect(rows[0].price).toBe(25.5)
    expect(await search!.getProducts(made.workspaceId, [productId, 'bad'])).toEqual([])
    expect((await search!.getProducts(made.workspaceId, [productId])).map((p) => p.name)).toEqual(['Pizza margarita'])
    // Another workspace's id never leaks through.
    expect(await search!.searchProducts('00000000-0000-0000-0000-000000000000', { text: 'margarita' })).toEqual([])
  })

  it('builds a report through the reports_* functions', async () => {
    const r = range!.resolveRange('30d', 'America/Lima')!
    const res = await reports!.buildReport({ workspace: ws, userId: made.userId, scope: 'workspace', range: r, channelId: null, agentId: null, teamId: null })
    expect(res.ok).toBe(true)
    const saved = await reports!.saveReportSettings(made.workspaceId, { sla_minutes: 15, usd_rate: 3.7 })
    expect(saved).toMatchObject({ sla_minutes: 15, usd_rate: 3.7 })
  })
})

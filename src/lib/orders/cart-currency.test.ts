// Runs against a real PostgreSQL with the baseline schema (skipped without TEST_DATABASE_URL):
//   TEST_DATABASE_URL=postgresql://crm:crm@127.0.0.1:5434/crm npx vitest run src/lib/orders
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { pgTest } from '@/lib/test-utils/pg'
import { fill, texts } from './texts'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/messaging/send', () => ({ sendMessage: vi.fn() }))
vi.mock('@/lib/ai/context', () => ({ invalidateBusinessContext: vi.fn() }))

describe('foreign currency message', () => {
  it('names the product and its currency', () => {
    expect(fill(texts('es').foreignCurrency, { name: 'Casa en La Molina', currency: 'USD' })).toBe('*Casa en La Molina* se cotiza en USD; te comunico con un asesor.')
  })
})

const pg = await pgTest()
// Imported only with a database: the Prisma client needs DATABASE_URL at load.
const svc = pg ? await import('./service') : null
type Cart = import('./service').Cart

describe.skipIf(!pg)('cart currency (orders are in the workspace currency)', () => {
  const addToCart = (...a: Parameters<NonNullable<typeof svc>['addToCart']>) => svc!.addToCart(...a)
  let made: Awaited<ReturnType<NonNullable<typeof pg>['workspace']>>
  let cart: Cart
  let usdSale = ''
  let penItem = ''

  beforeAll(async () => {
    made = await pg!.workspace()
    const ws = made.workspaceId
    await pg!.prisma.workspaces.update({ where: { id: ws }, data: { currency: 'PEN' } })
    const usd = await made.db.products.create({ data: { workspace_id: ws, name: 'Casa en La Molina', price: 350000, currency: 'USD', track_stock: false, is_active: true } })
    const pen = await made.db.products.create({ data: { workspace_id: ws, name: 'Llavero', price: 15, currency: null, track_stock: false, is_active: true } })
    usdSale = usd.id
    penItem = pen.id
    cart = (await made.db.carts.create({ data: { workspace_id: ws }, select: { id: true, workspace_id: true, conversation_id: true, contact_id: true, checkout: true } })) as Cart
  })
  afterAll(async () => {
    if (made) await pg!.cleanup(made)
  })

  it('refuses a product priced in another currency', async () => {
    const r = await addToCart(cart, usdSale, null, 1)
    expect(r).toEqual({ ok: false, reason: 'foreign_currency', name: 'Casa en La Molina', currency: 'USD' })
    expect(await made.db.cart_items.count({ where: { cart_id: cart.id } })).toBe(0)
  })

  it('adds products in the workspace currency', async () => {
    const r = await addToCart(cart, penItem, null, 2)
    expect(r).toMatchObject({ ok: true, quantity: 2 })
    expect(await made.db.cart_items.count({ where: { cart_id: cart.id } })).toBe(1)
  })

  it('treats a malformed product id as unavailable', async () => {
    expect(await addToCart(cart, 'not-a-uuid', null, 1)).toEqual({ ok: false, reason: 'unavailable' })
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeDb } from '@/lib/test-utils/fake-supabase'

const h = vi.hoisted(() => ({ db: null as unknown as import('@/lib/test-utils/fake-supabase').FakeDb }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => h.db }))

import { addToCart, type Cart } from './service'
import { fill, texts } from './texts'

const WS = 'ws-1'
const cart = { id: 'cart-1', workspace_id: WS } as unknown as Cart

describe('cart currency (orders are in the workspace currency)', () => {
  beforeEach(() => {
    // Embedded selects are ignored by FakeDb: the workspace join is stored on the row.
    h.db = new FakeDb({
      products: [
        { id: 'usd-sale', workspace_id: WS, name: 'Casa en La Molina', price: 350000, currency: 'USD', track_stock: false, stock: null, is_active: true, workspace: { currency: 'PEN' } },
        { id: 'pen-item', workspace_id: WS, name: 'Llavero', price: 15, currency: null, track_stock: false, stock: null, is_active: true, workspace: { currency: 'PEN' } },
      ],
      cart_items: [],
      carts: [{ id: 'cart-1', workspace_id: WS }],
    })
  })

  it('refuses a product priced in another currency', async () => {
    const r = await addToCart(cart, 'usd-sale', null, 1)
    expect(r).toEqual({ ok: false, reason: 'foreign_currency', name: 'Casa en La Molina', currency: 'USD' })
    expect(h.db.tables.cart_items).toHaveLength(0)
    if (!r.ok && r.reason === 'foreign_currency') {
      expect(fill(texts('es').foreignCurrency, { name: r.name, currency: r.currency })).toBe('*Casa en La Molina* se cotiza en USD; te comunico con un asesor.')
    }
  })

  it('adds products in the workspace currency', async () => {
    const r = await addToCart(cart, 'pen-item', null, 2)
    expect(r).toMatchObject({ ok: true, quantity: 2 })
    expect(h.db.tables.cart_items).toHaveLength(1)
  })
})

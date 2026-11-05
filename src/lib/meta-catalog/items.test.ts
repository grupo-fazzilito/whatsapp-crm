import { describe, expect, it } from 'vitest'
import { catalogBlocker, catalogItems, parseWaOrder, type CatalogProduct } from './items'

const ctx = {
  currency: 'PEN',
  brand: 'Moda Ana',
  productUrl: (id: string) => `https://whasalia.com/tienda/moda-ana/producto/${id}`,
  imageUrl: (u: string) => (/^https?:\/\//.test(u) ? u : u.startsWith('/') ? `https://whasalia.com${u}` : null),
}
const base: CatalogProduct = {
  id: 'p1',
  name: 'Casaca de jean',
  description: null,
  price: 149,
  compare_at_price: 199,
  currency: null,
  track_stock: true,
  stock: 4,
  images: ['/api/files/catalog/ws/a.jpg'],
  is_active: true,
  variants: [],
}

describe('Meta catalog items', () => {
  it('sends a simple product with sale price, stock and absolute image', () => {
    expect(catalogItems(base, ctx)).toEqual({
      upserts: [
        {
          id: 'p1',
          title: 'Casaca de jean',
          description: 'Casaca de jean',
          condition: 'new',
          link: 'https://whasalia.com/tienda/moda-ana/producto/p1',
          image: [{ url: 'https://whasalia.com/api/files/catalog/ws/a.jpg' }],
          brand: 'Moda Ana',
          price: '199.00 PEN',
          sale_price: '149.00 PEN',
          availability: 'in stock',
          quantity_to_sell_on_facebook: 4,
        },
      ],
      deletes: [],
    })
    expect(catalogItems({ ...base, stock: 0 }, ctx).upserts[0]).toMatchObject({ availability: 'out of stock' })
    expect(catalogItems({ ...base, stock: 0 }, ctx).upserts[0]).not.toHaveProperty('quantity_to_sell_on_facebook')
    expect(catalogItems({ ...base, track_stock: false }, ctx).upserts[0]).toMatchObject({ availability: 'in stock' })
  })

  it('sends variants grouped by the product and removes the product item', () => {
    const plan = catalogItems(
      {
        ...base,
        compare_at_price: null,
        variants: [
          { id: 'v1', name: 'Talla M', options: { Talla: 'M', color: 'Azul' }, price: null, stock: 0, is_active: true },
          { id: 'v2', name: 'Talla L', options: { talla: 'L' }, price: 159, stock: 2, is_active: true },
          { id: 'v3', name: 'Talla S', options: {}, price: 149, stock: 5, is_active: false },
        ],
      },
      ctx,
    )
    expect(plan.upserts.map((i) => [i.id, i.title, i.price, i.availability, i.item_group_id, i.size, i.color])).toEqual([
      ['v1', 'Casaca de jean - Talla M', '149.00 PEN', 'out of stock', 'p1', 'M', 'Azul'],
      ['v2', 'Casaca de jean - Talla L', '159.00 PEN', 'in stock', 'p1', 'L', undefined],
    ])
    expect(plan.deletes).toEqual(['p1', 'v3'])
  })

  it('keeps out what Meta can not take', () => {
    expect(catalogBlocker({ ...base, is_active: false }, ctx)).toBe('inactive')
    expect(catalogBlocker({ ...base, images: [] }, ctx)).toBe('image')
    expect(catalogBlocker({ ...base, price: null }, ctx)).toBe('price')
    expect(catalogBlocker({ ...base, currency: 'USD' }, ctx)).toBe('currency')
    expect(catalogItems({ ...base, images: [] , variants: [{ id: 'v1', name: 'M', options: {}, price: 1, stock: 1, is_active: true }] }, ctx)).toEqual({ upserts: [], deletes: ['p1', 'v1'] })
  })

  it('reads the cart sent from WhatsApp', () => {
    expect(
      parseWaOrder({
        catalog_id: '123',
        text: ' Para el sábado ',
        product_items: [
          { product_retailer_id: 'v2', quantity: 2, item_price: 159, currency: 'PEN' },
          { product_retailer_id: '', quantity: 1 },
          { product_retailer_id: 'p9', quantity: 0 },
        ],
      }),
    ).toEqual({ catalogId: '123', text: 'Para el sábado', items: [{ retailerId: 'v2', quantity: 2, price: 159, currency: 'PEN' }] })
    expect(parseWaOrder({ product_items: [] })).toBeNull()
    expect(parseWaOrder(null)).toBeNull()
  })
})

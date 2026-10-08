import { describe, expect, it } from 'vitest'
import { productAttributesFor } from './attributes'
import {
  applyMapping,
  categoryNames,
  guessMapping,
  normalizeRow,
  parseNumber,
  planUpsert,
  productPayload,
  splitMatrix,
} from './import'

const restaurant = productAttributesFor('restaurant')
const realEstate = productAttributesFor('real_estate')

describe('guessMapping', () => {
  it('maps Spanish headers with accents and case differences', () => {
    const m = guessMapping(['Nombre', 'Descripción', 'Precio', 'SKU', 'Stock', 'Categoría', 'Imagen', 'Etiquetas', 'Destacado', 'Activo'], [])
    expect(m).toEqual(['name', 'description', 'price', 'sku', 'stock', 'category', 'images', 'tags', 'is_featured', 'is_active'])
  })

  it('maps English headers and suffixed headers like "Price (PEN)"', () => {
    const m = guessMapping(['Product name', 'Price (PEN)', 'Category', 'Images', 'Unknown column'], [])
    expect(m).toEqual(['name', 'price', 'category', 'images', ''])
  })

  it('maps attribute columns by key or by label in either language', () => {
    const m = guessMapping(['name', 'allergens', 'Vegetariano', 'Spicy', 'Ingredientes'], restaurant)
    expect(m).toEqual(['name', 'attr:allergens', 'attr:vegetarian', 'attr:spicy', 'attr:ingredients'])
  })

  it('maps underscored attribute keys written with spaces', () => {
    const m = guessMapping(['area m2', 'Dormitorios', 'bedrooms'], realEstate)
    expect(m[0]).toBe('attr:area_m2')
    expect(m.filter((x) => x === 'attr:bedrooms')).toHaveLength(1)
  })

  it('uses each target only once (first column wins)', () => {
    expect(guessMapping(['Precio', 'Price'], [])).toEqual(['price', ''])
  })
})

describe('splitMatrix / applyMapping', () => {
  it('skips leading and blank rows and keeps source row numbers', () => {
    const { headers, rows } = splitMatrix([[], ['Nombre', 'Precio'], ['Lomo', '35'], ['', ''], ['Ceviche', 30]])
    expect(headers).toEqual(['Nombre', 'Precio'])
    expect(rows.map((r) => r.row)).toEqual([3, 5])
    expect(applyMapping(rows[1].cells, ['name', 'price'])).toEqual({ name: 'Ceviche', price: 30 })
  })

  it('drops ignored columns and empty cells', () => {
    expect(applyMapping(['A', '  ', 'x'], ['name', 'price', ''])).toEqual({ name: 'A' })
  })
})

describe('parseNumber', () => {
  it.each([
    ['S/ 25.50', 25.5],
    ['S/. 25', 25],
    ['$1,250.50', 1250.5],
    ['1.250,50', 1250.5],
    ['25,5', 25.5],
    ['12,500,000', 12500000],
    ['1.250.000', 1250000],
    [42, 42],
  ])('%s → %s', (input, expected) => {
    expect(parseNumber(input)).toBe(expected)
  })

  it('returns NaN for text', () => {
    expect(parseNumber('consultar')).toBeNaN()
  })
})

describe('normalizeRow', () => {
  it('coerces values and attributes', () => {
    const r = normalizeRow(
      {
        name: ' Lomo saltado ',
        price: 'S/ 35,90',
        stock: '12',
        images: 'https://x.test/a.jpg | https://x.test/b.jpg',
        tags: 'criollo, carne, criollo',
        is_featured: 'sí',
        'attr:allergens': 'Gluten, huevo',
        'attr:vegetarian': 'no',
      },
      restaurant,
      2,
    )
    expect(r.errors).toEqual([])
    expect(r.data).toMatchObject({
      name: 'Lomo saltado',
      price: 35.9,
      stock: 12,
      images: ['https://x.test/a.jpg', 'https://x.test/b.jpg'],
      tags: ['criollo', 'carne'],
      is_featured: true,
      attributes: { allergens: ['gluten', 'egg'], vegetarian: false },
    })
  })

  it('accepts attributes as an AI-style [{key, value}] list', () => {
    const r = normalizeRow({ name: 'Depa', attributes: [{ key: 'bedrooms', value: '3' }, { key: 'nope', value: 'x' }] }, realEstate, 1)
    expect(r.data.attributes).toEqual({ bedrooms: 3 })
  })

  it('reports missing name, bad numbers, bad URLs and bad options', () => {
    const r = normalizeRow(
      { price: 'abc', stock: '2.5', images: 'ftp://x.test/a.jpg', 'attr:allergens': 'plutonio' },
      restaurant,
      7,
    )
    expect(r.errors.map((e) => `${e.field}:${e.code}`).sort()).toEqual(
      ['attr:allergens:option', 'images:url', 'name:name_required', 'price:number', 'stock:integer'].sort(),
    )
  })

  it('rejects negative prices and relative image paths', () => {
    const r = normalizeRow({ name: 'X', price: '-5', images: '/img/a.png' }, [], 1)
    expect(r.errors.map((e) => e.code).sort()).toEqual(['negative', 'url'])
  })

  it('leaves unprovided fields undefined (so updates keep current values)', () => {
    const r = normalizeRow({ name: 'X', sku: 'A1' }, restaurant, 1)
    expect(r.data).toEqual({ name: 'X', sku: 'A1' })
  })
})

describe('planUpsert', () => {
  const rows = [
    normalizeRow({ name: 'A', sku: 'SKU-1' }, [], 2),
    normalizeRow({ name: 'B', sku: 'sku-2' }, [], 3),
    normalizeRow({ name: 'C' }, [], 4),
    normalizeRow({ name: 'D', sku: 'SKU-1' }, [], 5),
    normalizeRow({ price: 3 }, [], 6),
  ]

  it('updates existing SKUs (case-insensitive), creates the rest, flags duplicates and invalid rows', () => {
    const plan = planUpsert(rows, new Map([['SKU-2', 'p2']]))
    expect(plan.rows.map((r) => r.action)).toEqual(['create', 'update', 'create', 'error', 'error'])
    expect(plan.rows[1].productId).toBe('p2')
    expect(plan.rows[3].errors).toContainEqual({ field: 'sku', code: 'sku_duplicate' })
    expect(plan).toMatchObject({ creates: 2, updates: 1, errors: 2 })
  })

  it('requires required attributes only on creates', () => {
    const fields = [{ key: 'operation', type: 'select' as const, label: { es: 'Operación', en: 'Operation' }, required: true }]
    const plan = planUpsert(
      [normalizeRow({ name: 'New', sku: 'N1' }, fields, 2), normalizeRow({ name: 'Old', sku: 'O1' }, fields, 3)],
      { O1: 'p-old' },
      fields,
    )
    expect(plan.rows[0].action).toBe('error')
    expect(plan.rows[0].errors).toContainEqual({ field: 'attr:operation', code: 'required' })
    expect(plan.rows[1].action).toBe('update')
  })
})

describe('productPayload / categoryNames', () => {
  it('fills defaults on create and only touches provided fields on update', () => {
    const r = normalizeRow({ name: 'X', price: 10, stock: 3, 'attr:spicy': 'sí' }, restaurant, 1).data
    expect(productPayload(r, 'c1', 'create')).toEqual({
      name: 'X', price: 10, stock: 3, track_stock: true, category_id: 'c1', attributes: { spicy: true },
    })
    expect(productPayload(r, undefined, 'update', { vegetarian: true, spicy: false })).toEqual({
      name: 'X', price: 10, stock: 3, track_stock: true, attributes: { vegetarian: true, spicy: true },
    })
  })

  it('dedupes category names case-insensitively', () => {
    expect(categoryNames([{ name: 'a', category: 'Bebidas' }, { name: 'b', category: 'bebidas ' }, { name: 'c', category: 'Postres' }, { name: 'd' }])).toEqual([
      'Bebidas',
      'Postres',
    ])
  })
})

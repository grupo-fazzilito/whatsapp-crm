// Catalog management against a real PostgreSQL + the local storage driver:
//   TEST_DATABASE_URL=postgresql://crm:crm@127.0.0.1:5434/crm npx vitest run src/lib/catalog
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { AttributeField } from '@/lib/industries'
import { pgTest } from '@/lib/test-utils/pg'

vi.mock('server-only', () => ({}))

const FIELDS = [
  { key: 'pool', type: 'boolean' },
  { key: 'amenities', type: 'multiselect' },
  { key: 'zone', type: 'select' },
] as unknown as AttributeField[]

describe('searchTerms', async () => {
  const { searchTerms } = await import('./manage')
  it('builds an escaped ILIKE pattern and an accent-free prefix tsquery', () => {
    expect(searchTerms('Café Orgánico')).toEqual({ like: '%Café Orgánico%', tsquery: 'cafe:*&organico:*' })
    expect(searchTerms('50%_off')).toEqual({ like: '%50\\%\\_off%', tsquery: '50:*&off:*' })
    expect(searchTerms('a')).toEqual({ like: '%a%', tsquery: null })
  })
})

const pg = await pgTest()

describe.skipIf(!pg)('catalog management on PostgreSQL', async () => {
  const { listProducts, listCategories, saveProduct, deleteProducts, discardProductImages, parseProduct } = await import('./manage')
  const storage = await import('@/lib/storage')
  let dir = ''
  let a: Awaited<ReturnType<NonNullable<typeof pg>['workspace']>>
  let b: Awaited<ReturnType<NonNullable<typeof pg>['workspace']>>

  const product = (over: Record<string, unknown> = {}) =>
    parseProduct({ name: 'Producto', price: 10, images: [], tags: [], attributes: {}, track_stock: false, ...over })!

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'catalog-'))
    process.env.STORAGE_DIR = dir
    process.env.STORAGE_DRIVER = 'local'
    process.env.NEXT_PUBLIC_SITE_URL = 'https://app.test'
    a = await pg!.workspace()
    b = await pg!.workspace()
  })
  afterAll(async () => {
    await pg!.cleanup(a, b)
    await rm(dir, { recursive: true, force: true })
  })

  it('lists with text search (accent-insensitive), attribute, category and stock filters', async () => {
    const cat = await a.db.product_categories.create({ data: { workspace_id: a.workspaceId, name: 'Casas' } })
    const mk = (name: string, extra: Record<string, unknown>) =>
      a.db.products.create({ data: { workspace_id: a.workspaceId, name, ...extra }, select: { id: true } })
    const p1 = await mk('Casa Orgánica', { category_id: cat.id, attributes: { pool: true, amenities: ['gym', 'spa'], zone: 'norte' }, track_stock: true, stock: 0 })
    const p2 = await mk('Departamento', { sku: 'DEP-1', attributes: { amenities: ['gym'], zone: 'sur' }, is_featured: true })
    const p3 = await mk('Terreno', { attributes: { pool: false }, is_active: false })
    await a.db.product_variants.create({ data: { workspace_id: a.workspaceId, product_id: p1.id, name: 'A' } })
    await b.db.products.create({ data: { workspace_id: b.workspaceId, name: 'Casa ajena' } })

    const ids = async (f: Parameters<typeof listProducts>[2]) => (await listProducts(a.db, a.workspaceId, f, FIELDS)).products.map((p) => p.id)

    const all = await listProducts(a.db, a.workspaceId, {}, FIELDS)
    expect(all.total).toBe(3)
    expect(all.products[0].id).toBe(p2.id) // featured first
    expect(all.products.find((p) => p.id === p1.id)?.product_variants).toEqual([{ count: 1 }])
    expect(await ids({ q: 'organica' })).toEqual([p1.id])
    expect(await ids({ q: 'dep-1' })).toEqual([p2.id])
    expect(await ids({ q: 'casa' })).toEqual([p1.id]) // other workspace excluded
    expect((await ids({ attrs: { pool: 'true' } })).sort()).toEqual([p1.id])
    expect((await ids({ attrs: { pool: 'false' } })).sort()).toEqual([p2.id, p3.id].sort()) // missing key counts as "no"
    expect((await ids({ attrs: { amenities: 'gym' } })).sort()).toEqual([p1.id, p2.id].sort())
    expect(await ids({ attrs: { zone: 'sur' } })).toEqual([p2.id])
    expect(await ids({ attrs: { zone: 'sur' }, q: 'casa' })).toEqual([])
    expect(await ids({ category: cat.id })).toEqual([p1.id])
    expect((await ids({ category: 'none' })).sort()).toEqual([p2.id, p3.id].sort())
    expect(await ids({ status: 'inactive' })).toEqual([p3.id])
    expect(await ids({ featured: true })).toEqual([p2.id])
    expect((await ids({ inStock: true })).sort()).toEqual([p2.id, p3.id].sort())

    const cats = await listCategories(a.db)
    expect(cats).toEqual([expect.objectContaining({ id: cat.id, name: 'Casas', products: [{ count: 1 }] })])
  })

  it('creates and updates products with variants, removing dropped images', async () => {
    const img = async (name: string) => {
      const p = `${a.workspaceId}/products/${name}`
      await storage.uploadObject('catalog', p, Buffer.from('img'), 'image/png')
      return { path: p, url: storage.publicUrl('catalog', p) }
    }
    const i1 = await img('one.png')
    const i2 = await img('two.png')
    const legacy = `http://127.0.0.1:54321/storage/v1/object/public/catalog/${a.workspaceId}/products/old.png`

    const created = await saveProduct(a.db, a.workspaceId, a.userId, null, product({ name: 'Polo', images: [i1.url, i2.url, legacy], sku: 'POLO' }), [
      { id: null, name: 'S', options: { talla: 's' }, sku: null, price: 20, stock: 3, is_active: true, sort_order: 0 },
      { id: null, name: 'M', options: {}, sku: null, price: null, stock: null, is_active: true, sort_order: 1 },
    ])
    expect(created.ok).toBe(true)
    const id = (created as { id: string }).id
    const variants = await a.db.product_variants.findMany({ where: { product_id: id }, orderBy: { sort_order: 'asc' } })
    expect(variants.map((v) => [v.name, v.stock])).toEqual([
      ['S', null], // stock only when the product tracks it
      ['M', null],
    ])
    expect((await a.db.products.findFirst({ where: { id } }))?.created_by).toBe(a.userId)

    // Same SKU → sku_taken; foreign category → invalid_category.
    expect(await saveProduct(a.db, a.workspaceId, a.userId, null, product({ sku: 'POLO' }), [])).toMatchObject({ ok: false, error: 'sku_taken' })
    const foreign = await b.db.product_categories.create({ data: { workspace_id: b.workspaceId, name: 'X' } })
    expect(await saveProduct(a.db, a.workspaceId, a.userId, null, product({ category_id: foreign.id }), [])).toMatchObject({ ok: false, error: 'invalid_category' })

    // Update: drop variant M, rename S, add L, drop image two.
    const updated = await saveProduct(
      a.db,
      a.workspaceId,
      a.userId,
      id,
      product({ name: 'Polo 2', images: [i1.url, legacy], sku: 'POLO', track_stock: true, stock: 5 }),
      [
        { id: variants[0].id, name: 'Small', options: {}, sku: null, price: 20, stock: 2, is_active: true, sort_order: 0 },
        { id: null, name: 'L', options: {}, sku: null, price: 25, stock: 1, is_active: false, sort_order: 1 },
      ],
      [variants[1].id],
    )
    expect(updated).toEqual({ ok: true, id })
    const after = await a.db.product_variants.findMany({ where: { product_id: id }, orderBy: { sort_order: 'asc' } })
    expect(after.map((v) => [v.name, v.stock, v.is_active])).toEqual([
      ['Small', 2, true],
      ['L', 1, false],
    ])
    await expect(storage.downloadObject('catalog', i2.path)).rejects.toThrow(/not found/)
    expect((await storage.downloadObject('catalog', i1.path)).body.toString()).toBe('img')

    // Another workspace cannot update it, nor touch its variants.
    expect(await saveProduct(b.db, b.workspaceId, b.userId, id, product(), [])).toMatchObject({ ok: false, error: 'not_found' })
    expect(await saveProduct(a.db, a.workspaceId, a.userId, id, product({ images: [i1.url] }), [{ ...after[0], id: '00000000-0000-4000-8000-000000000000' } as never])).toMatchObject({
      ok: false,
      error: 'invalid_variant',
    })

    // Delete removes the row and its images.
    expect(await deleteProducts(b.db, b.workspaceId, [id])).toBe(0)
    expect(await deleteProducts(a.db, a.workspaceId, [id])).toBe(1)
    await expect(storage.downloadObject('catalog', i1.path)).rejects.toThrow(/not found/)
  })

  it('discards only unused product uploads of the workspace', async () => {
    const used = `${a.workspaceId}/products/used.png`
    const orphan = `${a.workspaceId}/products/orphan.png`
    const qr = `${a.workspaceId}/payments/qr.png`
    for (const p of [used, orphan, qr]) await storage.uploadObject('catalog', p, Buffer.from('x'), 'image/png')
    await a.db.products.create({ data: { workspace_id: a.workspaceId, name: 'Usa imagen', images: [storage.publicUrl('catalog', used)] } })
    expect(await discardProductImages(a.db, a.workspaceId, [used, orphan, qr, `${b.workspaceId}/products/x.png`])).toBe(1)
    await expect(storage.downloadObject('catalog', orphan)).rejects.toThrow(/not found/)
    expect((await storage.downloadObject('catalog', used)).body.toString()).toBe('x')
    expect((await storage.downloadObject('catalog', qr)).body.toString()).toBe('x')
  })
})

import 'server-only'
import { Prisma } from '@/generated/prisma/client'
import type { TenantDb } from '@/lib/db/tenant'
import { isPrismaError } from '@/lib/db/errors'
import { removeObjects } from '@/lib/storage'
import { storagePathFromUrl } from '@/lib/storage/paths'
import { isUuid } from '@/lib/workspace/constants'
import type { AttributeField } from '@/lib/industries'

// Catalog management for the dashboard (products, variants, categories).
// Replaces the browser's direct PostgREST queries; callers pass the
// workspace's tenant client, so every query stays inside the workspace.

export const PAGE_SIZE = 50
const MAX_IMAGES = 20
const MAX_TAGS = 30

/** Search box → ILIKE pattern and prefix tsquery (products.search is lowercase without accents). */
export function searchTerms(text: string): { like: string; tsquery: string | null } {
  const safe = text.replace(/["\\]/g, ' ').trim()
  const words = safe
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w.length > 1)
  const like = `%${safe.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
  return { like, tsquery: words.length ? words.map((w) => `${w}:*`).join('&') : null }
}

export interface ProductListFilters {
  page?: number
  q?: string
  /** '' all, 'none' uncategorized, or a category id. */
  category?: string
  status?: 'all' | 'active' | 'inactive'
  featured?: boolean
  inStock?: boolean
  /** {attribute key: value} from the quick filters. */
  attrs?: Record<string, string>
}

/** Ids matching the search text / attribute filters (null = no such filter). */
async function matchingIds(db: TenantDb, workspaceId: string, f: ProductListFilters, fields: AttributeField[]): Promise<string[] | null> {
  const conds: Prisma.Sql[] = []
  const q = f.q?.trim()
  if (q) {
    const { like, tsquery } = searchTerms(q)
    conds.push(
      tsquery
        ? Prisma.sql`(name ILIKE ${like} OR sku ILIKE ${like} OR search @@ to_tsquery('simple', ${tsquery}))`
        : Prisma.sql`(name ILIKE ${like} OR sku ILIKE ${like})`,
    )
  }
  for (const [k, v] of Object.entries(f.attrs ?? {})) {
    if (!v) continue
    const field = fields.find((x) => x.key === k)
    if (!field) continue
    if (field.type === 'boolean') {
      const json = JSON.stringify({ [k]: true })
      conds.push(v === 'true' ? Prisma.sql`attributes @> ${json}::jsonb` : Prisma.sql`NOT (attributes @> ${json}::jsonb)`)
    } else {
      const json = JSON.stringify({ [k]: field.type === 'multiselect' ? [v] : v })
      conds.push(Prisma.sql`attributes @> ${json}::jsonb`)
    }
  }
  if (!conds.length) return null
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT id FROM public.products WHERE workspace_id = ${workspaceId}::uuid AND ${Prisma.join(conds, ' AND ')}`
  return rows.map((r) => r.id)
}

function productWhere(f: ProductListFilters, ids: string[] | null): Prisma.productsWhereInput {
  const and: Prisma.productsWhereInput[] = []
  if (ids) and.push({ id: { in: ids } })
  if (f.category === 'none') and.push({ category_id: null })
  else if (f.category && isUuid(f.category)) and.push({ category_id: f.category })
  if (f.status === 'active' || f.status === 'inactive') and.push({ is_active: f.status === 'active' })
  if (f.featured) and.push({ is_featured: true })
  if (f.inStock) and.push({ OR: [{ track_stock: false }, { stock: { gt: 0 } }] })
  return and.length ? { AND: and } : {}
}

/** One page of products ('*, product_variants(count)') + the total for the filters. */
export async function listProducts(db: TenantDb, workspaceId: string, f: ProductListFilters, fields: AttributeField[]) {
  const ids = await matchingIds(db, workspaceId, f, fields)
  if (ids && !ids.length) return { products: [], total: 0 }
  const where = productWhere(f, ids)
  const page = Math.max(0, Math.floor(f.page ?? 0))
  const [rows, total] = await Promise.all([
    db.products.findMany({
      where,
      include: { _count: { select: { product_variants: true } } },
      orderBy: [{ is_featured: 'desc' }, { created_at: 'desc' }, { name: 'asc' }],
      skip: page * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    db.products.count({ where }),
  ])
  const products = rows.map(({ _count, ...p }) => ({ ...p, product_variants: [{ count: _count.product_variants }] }))
  return { products, total }
}

/** Categories with their product count ('…, products(count)'). */
export async function listCategories(db: TenantDb) {
  const rows = await db.product_categories.findMany({
    select: { id: true, name: true, description: true, sort_order: true, is_active: true, _count: { select: { products: true } } },
    orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
  })
  return rows.map(({ _count, ...c }) => ({ ...c, products: [{ count: _count.products }] }))
}

// ------------------------------------------------------------------
// Validation of browser input
// ------------------------------------------------------------------

const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)
const num = (v: unknown): number | null | undefined => {
  if (v === null || v === '' || v === undefined) return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : undefined
}
const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

export interface ProductInput {
  name: string
  description: string | null
  category_id: string | null
  price: number | null
  currency: string | null
  compare_at_price: number | null
  sku: string | null
  track_stock: boolean
  stock: number | null
  is_featured: boolean
  is_active: boolean
  tags: string[]
  images: string[]
  attributes: Record<string, unknown>
}

export interface VariantInput {
  id: string | null
  name: string
  options: Record<string, string>
  sku: string | null
  price: number | null
  stock: number | null
  is_active: boolean
  sort_order: number
}

export function parseProduct(raw: unknown): ProductInput | null {
  if (!isPlainObject(raw)) return null
  const name = str(raw.name, 200)
  const price = num(raw.price)
  const compare = num(raw.compare_at_price)
  const stock = num(raw.stock)
  if (!name || price === undefined || (price !== null && price < 0)) return null
  if (compare === undefined || (compare !== null && compare < 0)) return null
  if (stock === undefined || (stock !== null && (!Number.isInteger(stock) || stock < 0))) return null
  const category = raw.category_id
  if (category != null && category !== '' && (typeof category !== 'string' || !isUuid(category))) return null
  const currency = raw.currency == null || raw.currency === '' ? null : String(raw.currency).toUpperCase()
  if (currency !== null && !/^[A-Z]{3}$/.test(currency)) return null
  if (!Array.isArray(raw.images) || raw.images.length > MAX_IMAGES || !raw.images.every((u) => typeof u === 'string' && u.length > 0 && u.length <= 2000)) return null
  if (!Array.isArray(raw.tags) || !raw.tags.every((t) => typeof t === 'string')) return null
  if (raw.attributes !== undefined && !isPlainObject(raw.attributes)) return null
  return {
    name,
    description: str(raw.description, 5000),
    category_id: (category as string) || null,
    price,
    currency,
    compare_at_price: compare,
    sku: str(raw.sku, 100),
    track_stock: raw.track_stock === true,
    stock,
    is_featured: raw.is_featured === true,
    is_active: raw.is_active !== false,
    tags: [...new Set((raw.tags as string[]).map((t) => t.trim().slice(0, 40)).filter(Boolean))].slice(0, MAX_TAGS),
    images: raw.images as string[],
    attributes: (raw.attributes as Record<string, unknown>) ?? {},
  }
}

export function parseVariants(raw: unknown): VariantInput[] | null {
  if (raw === undefined) return []
  if (!Array.isArray(raw) || raw.length > 200) return null
  const out: VariantInput[] = []
  for (const [i, v] of raw.entries()) {
    if (!isPlainObject(v)) return null
    const name = str(v.name, 120)
    const price = num(v.price)
    const stock = num(v.stock)
    if (!name || price === undefined || (price !== null && price < 0)) return null
    if (stock === undefined || (stock !== null && (!Number.isInteger(stock) || stock < 0))) return null
    if (v.id != null && (typeof v.id !== 'string' || !isUuid(v.id))) return null
    const options: Record<string, string> = {}
    if (isPlainObject(v.options)) for (const [k, val] of Object.entries(v.options)) if (typeof val === 'string') options[k.slice(0, 60)] = val.slice(0, 120)
    out.push({
      id: (v.id as string | null) ?? null,
      name,
      options,
      sku: str(v.sku, 100),
      price,
      stock,
      is_active: v.is_active !== false,
      sort_order: typeof v.sort_order === 'number' && Number.isInteger(v.sort_order) ? v.sort_order : i,
    })
  }
  return out
}

// ------------------------------------------------------------------
// Writes
// ------------------------------------------------------------------

/** Catalog object paths of `urls` that belong to this workspace. */
export function ownCatalogPaths(workspaceId: string, urls: string[]): string[] {
  return urls.map((u) => storagePathFromUrl(u, 'catalog')).filter((p): p is string => !!p && p.startsWith(`${workspaceId}/`))
}

export type SaveProductResult =
  | { ok: true; id: string }
  | { ok: false; error: 'not_found' | 'sku_taken' | 'invalid_category' | 'invalid_variant'; status: number }

/**
 * Creates (productId null) or updates a product and syncs its variants:
 * deletes `removedVariantIds`, updates variants with an id, inserts the
 * rest. On update, catalog images the product no longer uses are removed.
 */
export async function saveProduct(
  db: TenantDb,
  workspaceId: string,
  userId: string,
  productId: string | null,
  product: ProductInput,
  variants: VariantInput[],
  removedVariantIds: string[] = [],
): Promise<SaveProductResult> {
  if (product.category_id && !(await db.product_categories.findFirst({ select: { id: true }, where: { id: product.category_id } }))) {
    return { ok: false, error: 'invalid_category', status: 400 }
  }
  const data = { ...product, attributes: product.attributes as Prisma.InputJsonValue }
  let id: string
  let before: string[] = []
  try {
    if (productId) {
      const existing = await db.products.findFirst({ select: { images: true }, where: { id: productId } })
      if (!existing) return { ok: false, error: 'not_found', status: 404 }
      before = existing.images
      await db.products.update({ where: { id: productId }, data, select: { id: true } })
      id = productId
    } else {
      id = (await db.products.create({ data: { ...data, workspace_id: workspaceId, created_by: userId }, select: { id: true } })).id
    }
  } catch (err) {
    if (isPrismaError(err, 'P2002')) return { ok: false, error: 'sku_taken', status: 409 }
    if (isPrismaError(err, 'P2025')) return { ok: false, error: 'not_found', status: 404 }
    throw err
  }

  // Variants of this product only.
  const known = new Set(
    (await db.product_variants.findMany({ select: { id: true }, where: { product_id: id } })).map((v) => v.id),
  )
  const removed = removedVariantIds.filter((v) => known.has(v))
  if (removed.length) await db.product_variants.deleteMany({ where: { id: { in: removed }, product_id: id } })
  for (const v of variants) {
    const row = { name: v.name, options: v.options, sku: v.sku, price: v.price, stock: product.track_stock ? v.stock : null, is_active: v.is_active, sort_order: v.sort_order }
    if (v.id) {
      if (!known.has(v.id)) return { ok: false, error: 'invalid_variant', status: 400 }
      await db.product_variants.updateMany({ where: { id: v.id, product_id: id }, data: row })
    } else {
      await db.product_variants.create({ data: { ...row, product_id: id, workspace_id: workspaceId } })
    }
  }

  // Images dropped from the product.
  if (before.length) {
    const after = new Set(ownCatalogPaths(workspaceId, product.images))
    const orphans = ownCatalogPaths(workspaceId, before).filter((p) => !after.has(p))
    if (orphans.length) await removeObjects('catalog', orphans).catch((err) => console.warn('[catalog] image cleanup failed:', err instanceof Error ? err.message : err))
  }
  return { ok: true, id }
}

/** Deletes products and their catalog images. Returns how many were deleted. */
export async function deleteProducts(db: TenantDb, workspaceId: string, ids: string[]): Promise<number> {
  const rows = await db.products.findMany({ select: { id: true, images: true }, where: { id: { in: ids } } })
  if (!rows.length) return 0
  const { count } = await db.products.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } })
  const paths = ownCatalogPaths(workspaceId, rows.flatMap((r) => r.images))
  if (paths.length) await removeObjects('catalog', paths).catch((err) => console.warn('[catalog] image cleanup failed:', err instanceof Error ? err.message : err))
  return count
}

/**
 * Removes freshly uploaded product images that no product uses (a save
 * that failed after the upload). Only `<workspace>/products/…` paths.
 */
export async function discardProductImages(db: TenantDb, workspaceId: string, paths: string[]): Promise<number> {
  const candidates = [...new Set(paths)].filter((p) => p.startsWith(`${workspaceId}/products/`) && !p.includes('..'))
  if (!candidates.length) return 0
  const used = await db.products.findMany({ select: { images: true }, where: { images: { isEmpty: false } } })
  const inUse = new Set(ownCatalogPaths(workspaceId, used.flatMap((u) => u.images)))
  const free = candidates.filter((p) => !inUse.has(p))
  if (free.length) await removeObjects('catalog', free)
  return free.length
}

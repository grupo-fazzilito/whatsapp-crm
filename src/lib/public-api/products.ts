import 'server-only'
import type { Prisma } from '@/generated/prisma/client'
import { isPrismaError } from '@/lib/db/errors'
import { tenantDb } from '@/lib/db/tenant'
import { invalidateBusinessContext } from '@/lib/ai/context'
import { productAttributesFor, validateAttributes } from '@/lib/catalog/attributes'
import { PRODUCT_CURRENCIES, parseCurrency } from '@/lib/catalog/currency'
import type { Workspace } from '@/lib/workspace/types'
import { ApiError, badRequest, notFound, unprocessable } from './errors'
import { pgError } from './db-error'
import { keysetPage } from './keyset'
import { parseIsoParam } from './pagination'
import { serializeProduct } from './serializers'
import { bool, has, isUuidLike, num, obj, queryUuid, str, strArray, uuid } from './validate'

type Body = Record<string, unknown>

// PRODUCT_SELECT (serializers.ts) as a Prisma select.
const PRODUCT_FIELDS = {
  id: true,
  name: true,
  description: true,
  price: true,
  compare_at_price: true,
  currency: true,
  sku: true,
  stock: true,
  track_stock: true,
  images: true,
  tags: true,
  attributes: true,
  is_active: true,
  is_featured: true,
  category_id: true,
  sort_order: true,
  external_url: true,
  created_at: true,
  updated_at: true,
  product_variants: { select: { id: true, name: true, options: true, sku: true, price: true, stock: true, is_active: true, sort_order: true } },
} as const

type ProductRow = Record<string, unknown> & { id: string }

export async function listProducts(ws: Workspace, url: URL) {
  const sp = url.searchParams
  const where: Record<string, unknown> = { workspace_id: ws.id }
  const search = sp.get('q')?.trim()
  if (search) where.name = { contains: search.replace(/[%_,()]/g, ' ').slice(0, 100), mode: 'insensitive' }
  const sku = sp.get('sku')?.trim()
  if (sku) where.sku = sku
  const active = sp.get('active')
  if (active === 'true' || active === 'false') where.is_active = active === 'true'
  else if (active) throw badRequest('active must be true or false.', { field: 'active' })
  const categoryId = queryUuid(url, 'category_id')
  if (categoryId) where.category_id = categoryId
  const since = parseIsoParam(sp.get('updated_since'))
  if (since) where.updated_at = { gte: since }
  const db = tenantDb(ws.id)
  const page = await keysetPage({
    workspaceId: ws.id,
    table: 'products',
    column: 'created_at',
    where,
    url,
    findMany: (args) => db.products.findMany({ ...args, select: PRODUCT_FIELDS }) as unknown as Promise<ProductRow[]>,
  })
  return { data: page.data.map((p) => serializeProduct(p, ws.currency)), next_cursor: page.next_cursor }
}

async function productRow(ws: Workspace, id: string) {
  if (!isUuidLike(id)) throw notFound('Product')
  const data = await tenantDb(ws.id)
    .products.findFirst({ select: PRODUCT_FIELDS, where: { id, workspace_id: ws.id } })
    .catch(() => null)
  if (!data) throw notFound('Product')
  return data as unknown as ProductRow & { attributes: Record<string, unknown> | null }
}

export async function getProduct(ws: Workspace, id: string) {
  return serializeProduct(await productRow(ws, id), ws.currency)
}

/** null = the workspace currency. Unknown codes → 422. */
export function readCurrency(body: Body, workspaceCurrency: string): string | null | undefined {
  if (!has(body, 'currency')) return undefined
  if (body.currency === null || body.currency === '') return null
  const code = parseCurrency(body.currency)
  if (!code || !PRODUCT_CURRENCIES.includes(code)) {
    throw unprocessable('invalid_currency', `currency must be one of: ${PRODUCT_CURRENCIES.join(', ')}.`, { field: 'currency' })
  }
  return code === (workspaceCurrency || '').toUpperCase() ? null : code
}

function readImages(body: Body): string[] | undefined {
  const list = strArray(body, 'images', { max: 20, itemMax: 2000 })
  if (!list) return undefined
  for (const u of list) {
    try {
      const parsed = new URL(u)
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error()
    } catch {
      throw badRequest('images must be http(s) URLs.', { field: 'images' })
    }
  }
  return list
}

async function readFields(ws: Workspace, body: Body, existingAttributes: Record<string, unknown> | null) {
  const row: Record<string, unknown> = {}
  const name = str(body, 'name', { max: 200, required: existingAttributes === null, nullable: false })
  if (name !== undefined) row.name = name
  const description = str(body, 'description', { max: 5000 })
  if (description !== undefined) row.description = description
  const price = num(body, 'price', { min: 0, max: 1e12 })
  if (price !== undefined) row.price = price
  const compare = num(body, 'compare_at_price', { min: 0, max: 1e12 })
  if (compare !== undefined) row.compare_at_price = compare
  const currency = readCurrency(body, ws.currency)
  if (currency !== undefined) row.currency = currency
  const sku = str(body, 'sku', { max: 100 })
  if (sku !== undefined) row.sku = sku
  const trackStock = bool(body, 'track_stock')
  if (trackStock !== undefined) row.track_stock = trackStock
  const stock = num(body, 'stock', { min: 0, max: 1e9, integer: true })
  if (stock !== undefined) row.stock = stock
  const images = readImages(body)
  if (images !== undefined) row.images = images
  const tags = strArray(body, 'tags', { max: 30, itemMax: 50 })
  if (tags !== undefined) row.tags = tags
  const isActive = bool(body, 'is_active')
  if (isActive !== undefined) row.is_active = isActive
  const isFeatured = bool(body, 'is_featured')
  if (isFeatured !== undefined) row.is_featured = isFeatured
  const categoryId = uuid(body, 'category_id')
  if (categoryId !== undefined) {
    if (categoryId) {
      const data = await tenantDb(ws.id)
        .product_categories.findFirst({ select: { id: true }, where: { id: categoryId, workspace_id: ws.id } })
        .catch(() => null)
      if (!data) throw unprocessable('invalid_category', 'category_id is not a category of this workspace.', { field: 'category_id' })
    }
    row.category_id = categoryId
  }

  // Attributes are validated against the industry preset + workspace fields;
  // on PATCH the sent keys are merged over the stored values first.
  const rawAttributes = obj(body, 'attributes')
  if (rawAttributes !== undefined || existingAttributes === null) {
    const fields = productAttributesFor(ws.industry, ws.settings)
    const merged = { ...(existingAttributes ?? {}), ...(rawAttributes ?? {}) }
    const { values, errors } = validateAttributes(fields, merged)
    if (Object.keys(errors).length) {
      throw unprocessable('invalid_attributes', 'Some attributes are missing or invalid.', { errors, allowed: fields.map((f) => ({ key: f.key, type: f.type, required: !!f.required, options: f.options?.map((o) => o.value) ?? null })) })
    }
    row.attributes = values
  }
  return row
}

function writeError(err: unknown): never {
  const error = pgError(err)
  if (error.code === '23505' || isPrismaError(err, 'P2002')) throw new ApiError(409, 'sku_taken', 'Another product already uses this SKU.')
  if (error.code === '23514' || error.code === '22P02') throw badRequest(error.message)
  throw err instanceof Error ? err : new Error(error.message)
}

export async function createProduct(ws: Workspace, body: Body, userId: string | null) {
  const row = await readFields(ws, body, null)
  let data: { id: string }
  try {
    data = await tenantDb(ws.id).products.create({
      data: { ...row, workspace_id: ws.id, created_by: userId } as Prisma.productsUncheckedCreateInput,
      select: { id: true },
    })
  } catch (error) {
    writeError(error)
  }
  invalidateBusinessContext(ws.id)
  return getProduct(ws, data.id)
}

export async function updateProduct(ws: Workspace, id: string, body: Body) {
  const current = await productRow(ws, id)
  const row = await readFields(ws, body, current.attributes ?? {})
  if (!Object.keys(row).length) throw badRequest('Nothing to update.')
  try {
    await tenantDb(ws.id).products.updateMany({ where: { id, workspace_id: ws.id }, data: row })
  } catch (error) {
    writeError(error)
  }
  invalidateBusinessContext(ws.id)
  return getProduct(ws, id)
}

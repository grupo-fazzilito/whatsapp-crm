import 'server-only'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { invalidateBusinessContext } from '@/lib/ai/context'
import { productAttributesFor, validateAttributes } from '@/lib/catalog/attributes'
import { PRODUCT_CURRENCIES, parseCurrency } from '@/lib/catalog/currency'
import type { Workspace } from '@/lib/workspace/types'
import { ApiError, badRequest, notFound, unprocessable } from './errors'
import { listPage } from './list'
import { parseIsoParam } from './pagination'
import { PRODUCT_SELECT, serializeProduct } from './serializers'
import { bool, has, isUuidLike, num, obj, queryUuid, str, strArray, uuid } from './validate'

type Body = Record<string, unknown>

export async function listProducts(ws: Workspace, url: URL) {
  const sp = url.searchParams
  let q = supabaseAdmin().from('products').select(PRODUCT_SELECT).eq('workspace_id', ws.id)
  const search = sp.get('q')?.trim()
  if (search) q = q.ilike('name', `%${search.replace(/[%_,()]/g, ' ').slice(0, 100)}%`)
  const sku = sp.get('sku')?.trim()
  if (sku) q = q.eq('sku', sku)
  const active = sp.get('active')
  if (active === 'true' || active === 'false') q = q.eq('is_active', active === 'true')
  else if (active) throw badRequest('active must be true or false.', { field: 'active' })
  const categoryId = queryUuid(url, 'category_id')
  if (categoryId) q = q.eq('category_id', categoryId)
  const since = parseIsoParam(sp.get('updated_since'))
  if (since) q = q.gte('updated_at', since)
  const page = await listPage<Record<string, unknown> & { id: string }>(q, 'created_at', url)
  return { data: page.data.map((p) => serializeProduct(p, ws.currency)), next_cursor: page.next_cursor }
}

async function productRow(ws: Workspace, id: string) {
  if (!isUuidLike(id)) throw notFound('Product')
  const { data } = await supabaseAdmin().from('products').select(PRODUCT_SELECT).eq('id', id).eq('workspace_id', ws.id).maybeSingle()
  if (!data) throw notFound('Product')
  return data as Record<string, unknown> & { id: string; attributes: Record<string, unknown> | null }
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
      const { data } = await supabaseAdmin().from('product_categories').select('id').eq('id', categoryId).eq('workspace_id', ws.id).maybeSingle()
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

function writeError(error: { code?: string; message: string }): never {
  if (error.code === '23505') throw new ApiError(409, 'sku_taken', 'Another product already uses this SKU.')
  if (error.code === '23514' || error.code === '22P02') throw badRequest(error.message)
  throw new Error(error.message)
}

export async function createProduct(ws: Workspace, body: Body, userId: string | null) {
  const row = await readFields(ws, body, null)
  const { data, error } = await supabaseAdmin()
    .from('products')
    .insert({ ...row, workspace_id: ws.id, created_by: userId })
    .select('id')
    .single()
  if (error || !data) writeError(error ?? { message: 'product insert failed' })
  invalidateBusinessContext(ws.id)
  return getProduct(ws, data.id)
}

export async function updateProduct(ws: Workspace, id: string, body: Body) {
  const current = await productRow(ws, id)
  const row = await readFields(ws, body, current.attributes ?? {})
  if (!Object.keys(row).length) throw badRequest('Nothing to update.')
  const { error } = await supabaseAdmin().from('products').update(row).eq('id', id).eq('workspace_id', ws.id)
  if (error) writeError(error)
  invalidateBusinessContext(ws.id)
  return getProduct(ws, id)
}

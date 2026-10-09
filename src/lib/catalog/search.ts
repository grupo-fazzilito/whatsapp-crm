import 'server-only'
import { prisma } from '@/lib/db/prisma'
import { tenantDb } from '@/lib/db/tenant'
import { normalizeRaw } from '@/lib/db/compat'
import { isUuid } from '@/lib/workspace/constants'

export interface ProductRow {
  id: string
  workspace_id: string
  category_id: string | null
  name: string
  description: string | null
  price: number | null
  compare_at_price: number | null
  /** ISO 4217; null = workspace currency (migration 039). */
  currency?: string | null
  sku: string | null
  stock: number | null
  track_stock: boolean
  images: string[]
  tags: string[]
  attributes: Record<string, unknown>
  is_active: boolean
  is_featured: boolean
}

export interface CatalogQuery {
  text?: string | null
  categoryId?: string | null
  /** {attr: value | value[]} plus "<attr>__min" / "<attr>__max" for numbers */
  filters?: Record<string, unknown>
  minPrice?: number | null
  maxPrice?: number | null
  /** Currency of min/maxPrice: bounds only apply to products priced in it. */
  priceCurrency?: string | null
  inStockOnly?: boolean
  limit?: number
}

/** Full-text + attribute search (public.search_products). */
export async function searchProducts(workspaceId: string, q: CatalogQuery): Promise<ProductRow[]> {
  try {
    // The function filters by `ws` itself. Every products column, with the
    // tsvector as text (as PostgREST sent it; Prisma can't read tsvector).
    const rows = await prisma.$queryRaw<ProductRow[]>`
      SELECT p.id, p.workspace_id, p.category_id, p.name, p.description, p.price, p.compare_at_price, p.sku, p.stock,
             p.track_stock, p.images, p.tags, p.attributes, p.is_active, p.is_featured, p.sort_order, p.search::text AS search,
             p.created_by, p.created_at, p.updated_at, p.external_source, p.external_id, p.external_url,
             p.external_synced_at, p.external_missing_since, p.currency
      FROM public.search_products(
        ${workspaceId}::uuid,
        ${q.text?.trim() || null}::text,
        ${q.categoryId || null}::uuid,
        ${JSON.stringify(q.filters ?? {})}::jsonb,
        ${q.minPrice ?? null}::numeric,
        ${q.maxPrice ?? null}::numeric,
        ${!!q.inStockOnly}::boolean,
        ${q.limit ?? 8}::int,
        ${q.priceCurrency?.toUpperCase() || null}::text
      ) AS p`
    return normalizeRaw(rows)
  } catch (err) {
    console.error('[catalog] search failed:', err instanceof Error ? err.message : err)
    return []
  }
}

export async function getProducts(workspaceId: string, ids: string[]): Promise<ProductRow[]> {
  if (!ids.length) return []
  const wanted = ids.slice(0, 20)
  // A malformed id failed the whole PostgREST query.
  if (!wanted.every(isUuid)) return []
  const data = await tenantDb(workspaceId).products.findMany({ where: { is_active: true, id: { in: wanted } } })
  return data as unknown as ProductRow[]
}

export function inStock(p: Pick<ProductRow, 'track_stock' | 'stock'>): boolean {
  return !p.track_stock || (p.stock ?? 0) > 0
}

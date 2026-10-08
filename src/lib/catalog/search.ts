import 'server-only'
import { supabaseAdmin } from '@/lib/supabase/admin'

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
  const { data, error } = await supabaseAdmin().rpc('search_products', {
    ws: workspaceId,
    q: q.text?.trim() || null,
    category: q.categoryId || null,
    filters: q.filters ?? {},
    min_price: q.minPrice ?? null,
    max_price: q.maxPrice ?? null,
    in_stock_only: !!q.inStockOnly,
    max_results: q.limit ?? 8,
    price_currency: q.priceCurrency?.toUpperCase() || null,
  })
  if (error) {
    console.error('[catalog] search failed:', error.message)
    return []
  }
  return (data ?? []) as ProductRow[]
}

export async function getProducts(workspaceId: string, ids: string[]): Promise<ProductRow[]> {
  if (!ids.length) return []
  const { data } = await supabaseAdmin()
    .from('products')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('is_active', true)
    .in('id', ids.slice(0, 20))
  return (data ?? []) as ProductRow[]
}

export function inStock(p: Pick<ProductRow, 'track_stock' | 'stock'>): boolean {
  return !p.track_stock || (p.stock ?? 0) > 0
}

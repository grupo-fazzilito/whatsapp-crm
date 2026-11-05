// Whasalia product → items of the business's Meta catalog (WhatsApp catalog
// and cart). Pure. The item id ("retailer id") is our own id: the product's
// when it has no variants, each variant's otherwise (grouped by the
// product id), so an order from the WhatsApp cart maps straight back.
// https://developers.facebook.com/docs/marketing-api/reference/product-catalog/items_batch

export interface CatalogProduct {
  id: string
  name: string
  description: string | null
  price: number | null
  compare_at_price: number | null
  currency: string | null
  track_stock: boolean
  stock: number | null
  images: string[]
  is_active: boolean
  variants: { id: string; name: string; options: Record<string, string>; price: number | null; stock: number | null; is_active: boolean }[]
}

export interface CatalogContext {
  /** Workspace currency (products in another currency stay out). */
  currency: string
  /** Business name, sent as the brand. */
  brand: string
  /** Absolute product page URL in the store. */
  productUrl: (productId: string) => string
  /** Absolute URL of an image (stored ones may be relative). */
  imageUrl: (url: string) => string | null
}

export interface CatalogItem {
  id: string
  title: string
  description: string
  availability: 'in stock' | 'out of stock'
  condition: 'new'
  price: string
  sale_price?: string
  link: string
  image: { url: string }[]
  brand: string
  item_group_id?: string
  quantity_to_sell_on_facebook?: number
  size?: string
  color?: string
}

export interface CatalogPlan {
  upserts: CatalogItem[]
  /** Item ids that must not be in the catalog (inactive, no photo, no price…). */
  deletes: string[]
}

const money = (n: number, currency: string) => `${n.toFixed(2)} ${currency}`
const SIZE_KEYS = ['talla', 'size', 'tamaño', 'tamano', 'medida']
const COLOR_KEYS = ['color', 'colour']

function pick(options: Record<string, string>, keys: string[]): string | undefined {
  for (const [k, v] of Object.entries(options)) if (keys.includes(k.toLowerCase()) && v) return v.slice(0, 100)
  return undefined
}

/** Why a product can't be in the catalog (null = it can). */
export function catalogBlocker(p: CatalogProduct, ctx: CatalogContext): 'inactive' | 'currency' | 'image' | 'price' | null {
  if (!p.is_active) return 'inactive'
  if (p.currency && p.currency !== ctx.currency) return 'currency'
  if (!p.images.some((u) => ctx.imageUrl(u))) return 'image'
  const priced = p.price !== null || p.variants.some((v) => v.is_active && v.price !== null)
  if (!priced) return 'price'
  return null
}

export function catalogItems(p: CatalogProduct, ctx: CatalogContext): CatalogPlan {
  const allIds = [p.id, ...p.variants.map((v) => v.id)]
  if (catalogBlocker(p, ctx)) return { upserts: [], deletes: allIds }

  const images = p.images.map(ctx.imageUrl).filter((u): u is string => !!u).slice(0, 10).map((url) => ({ url }))
  const base = {
    description: (p.description?.trim() || p.name).slice(0, 5000),
    condition: 'new' as const,
    link: ctx.productUrl(p.id),
    image: images,
    brand: ctx.brand.slice(0, 100) || 'Store',
  }
  const priceFields = (price: number) =>
    p.compare_at_price !== null && p.compare_at_price > price
      ? { price: money(p.compare_at_price, ctx.currency), sale_price: money(price, ctx.currency) }
      : { price: money(price, ctx.currency) }
  const stockFields = (left: number | null) =>
    left === null
      ? { availability: 'in stock' as const }
      : left > 0
        ? { availability: 'in stock' as const, quantity_to_sell_on_facebook: left }
        : { availability: 'out of stock' as const }

  const active = p.variants.filter((v) => v.is_active)
  if (!active.length) {
    const left = p.track_stock ? Math.max(0, p.stock ?? 0) : null
    return {
      upserts: [{ id: p.id, title: p.name.slice(0, 150), ...base, ...priceFields(p.price!), ...stockFields(left) }],
      deletes: p.variants.map((v) => v.id),
    }
  }

  const upserts: CatalogItem[] = []
  const deletes = [p.id, ...p.variants.filter((v) => !v.is_active).map((v) => v.id)]
  for (const v of active) {
    const price = v.price ?? p.price
    if (price === null) {
      deletes.push(v.id)
      continue
    }
    const left = p.track_stock ? Math.max(0, v.stock ?? p.stock ?? 0) : null
    const size = pick(v.options, SIZE_KEYS)
    const color = pick(v.options, COLOR_KEYS)
    upserts.push({
      id: v.id,
      title: `${p.name} - ${v.name}`.slice(0, 150),
      ...base,
      ...priceFields(price),
      ...stockFields(left),
      item_group_id: p.id,
      ...(size ? { size } : {}),
      ...(color ? { color } : {}),
    })
  }
  return { upserts, deletes }
}

// ------------------------------------------------------------------
// Orders from the WhatsApp cart (webhook message type "order")
// ------------------------------------------------------------------
export interface WaOrderItem {
  retailerId: string
  quantity: number
  price: number | null
  currency: string | null
}

export function parseWaOrder(raw: unknown): { catalogId: string | null; text: string | null; items: WaOrderItem[] } | null {
  const o = (raw && typeof raw === 'object' ? raw : null) as Record<string, unknown> | null
  if (!o || !Array.isArray(o.product_items)) return null
  const items: WaOrderItem[] = []
  for (const it of o.product_items as Record<string, unknown>[]) {
    const id = typeof it?.product_retailer_id === 'string' ? it.product_retailer_id.trim() : ''
    const qty = Number(it?.quantity)
    if (!id || !Number.isInteger(qty) || qty <= 0) continue
    const price = Number(it?.item_price)
    items.push({ retailerId: id.slice(0, 100), quantity: Math.min(qty, 999), price: Number.isFinite(price) ? price : null, currency: typeof it?.currency === 'string' ? it.currency : null })
  }
  if (!items.length) return null
  return { catalogId: typeof o.catalog_id === 'string' ? o.catalog_id : null, text: typeof o.text === 'string' && o.text.trim() ? o.text.trim().slice(0, 1000) : null, items }
}

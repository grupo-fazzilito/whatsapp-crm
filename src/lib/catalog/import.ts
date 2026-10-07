import type { AttributeField } from '@/lib/industries'
import { validateAttributes, type AttributeValue } from './attributes'

// Bulk catalog import — pure, client-safe helpers shared by the import
// dialog (column mapping, preview) and the import route (re-validation,
// upsert planning). Nothing here touches the network or the database.

export const MAX_IMPORT_ROWS = 2000
export const IMPORT_BATCH = 200
export const MAX_IMAGES = 10
export const MAX_TAGS = 20

export const FIXED_TARGETS = [
  'name',
  'description',
  'price',
  'compare_at_price',
  'sku',
  'stock',
  'category',
  'images',
  'tags',
  'is_featured',
  'is_active',
] as const

export type FixedTarget = (typeof FIXED_TARGETS)[number]
/** Where a source column goes: a fixed product column, `attr:<key>` or '' (ignored). */
export type ImportTarget = FixedTarget | `attr:${string}` | ''

/** One normalized product row. Undefined = not provided (keeps the current value on update). */
export interface ImportRow {
  name: string
  description?: string | null
  price?: number | null
  compare_at_price?: number | null
  sku?: string | null
  stock?: number | null
  category?: string | null
  images?: string[]
  tags?: string[]
  is_featured?: boolean
  is_active?: boolean
  attributes?: Record<string, AttributeValue>
}

export interface RowError {
  /** Fixed target or `attr:<key>`. */
  field: string
  /** name_required | number | integer | negative | url | too_many | required | option | sku_duplicate */
  code: string
}

export interface NormalizedRow {
  /** 1-based row number in the source (spreadsheet line or list position). */
  row: number
  data: ImportRow
  errors: RowError[]
}

/** Raw values keyed by target; attributes may also come nested. */
export type RawRecord = Partial<Record<FixedTarget, unknown>> & {
  attributes?: Record<string, unknown> | { key: string; value: unknown }[]
  [attrTarget: `attr:${string}`]: unknown
}

// ------------------------------------------------------------------
// Column auto-mapping
// ------------------------------------------------------------------

/** lowercase, no accents, non-alphanumerics collapsed to single spaces */
export function normalizeHeader(h: unknown): string {
  return String(h ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

const SYNONYMS: Record<FixedTarget, string[]> = {
  name: ['nombre', 'name', 'producto', 'product', 'titulo', 'title', 'platillo', 'plato', 'articulo', 'item', 'propiedad', 'nombre del producto', 'product name'],
  description: ['descripcion', 'description', 'detalle', 'detalles', 'details', 'desc'],
  price: ['precio', 'price', 'valor', 'pvp', 'precio venta', 'precio de venta', 'sale price', 'importe', 'costo', 'cost'],
  compare_at_price: ['precio anterior', 'precio regular', 'precio antes', 'precio original', 'compare at price', 'compare price', 'regular price', 'old price', 'precio tachado'],
  sku: ['sku', 'codigo', 'code', 'ref', 'referencia', 'reference', 'id producto', 'product id', 'codigo sku'],
  stock: ['stock', 'inventario', 'inventory', 'cantidad', 'quantity', 'qty', 'existencias', 'unidades', 'units'],
  category: ['categoria', 'category', 'categorias', 'categories', 'seccion', 'section', 'coleccion', 'collection', 'rubro'],
  images: ['imagen', 'imagenes', 'image', 'images', 'foto', 'fotos', 'photo', 'photos', 'image url', 'image urls', 'url imagen', 'url de imagen', 'imagen url', 'picture', 'pictures'],
  tags: ['etiquetas', 'etiqueta', 'tags', 'tag', 'palabras clave', 'keywords'],
  is_featured: ['destacado', 'destacada', 'destacados', 'featured', 'is featured', 'recomendado'],
  is_active: ['activo', 'activa', 'active', 'is active', 'habilitado', 'enabled', 'visible', 'publicado', 'published'],
}

/**
 * Best target for each header (same order as `headers`). Exact names win,
 * then a header that starts with a synonym ("Precio (PEN)"). Each target
 * is used at most once — the first matching column wins.
 */
export function guessMapping(headers: unknown[], fields: AttributeField[]): ImportTarget[] {
  const norm = headers.map(normalizeHeader)
  const result: ImportTarget[] = norm.map(() => '')
  const used = new Set<ImportTarget>()

  const candidates: { target: ImportTarget; names: string[] }[] = [
    ...FIXED_TARGETS.map((t) => ({ target: t as ImportTarget, names: SYNONYMS[t] })),
    ...fields.map((f) => ({
      target: `attr:${f.key}` as ImportTarget,
      names: [...new Set([normalizeHeader(f.key), normalizeHeader(f.key.replace(/_/g, ' ')), normalizeHeader(f.label.es), normalizeHeader(f.label.en)])],
    })),
  ]

  const assign = (match: (h: string, name: string) => boolean) => {
    norm.forEach((h, i) => {
      if (!h || result[i]) return
      const c = candidates.find((c) => !used.has(c.target) && c.names.some((n) => n && match(h, n)))
      if (c) {
        result[i] = c.target
        used.add(c.target)
      }
    })
  }
  // Pass 1: exact; pass 2: header begins with the name as whole words.
  assign((h, n) => h === n)
  assign((h, n) => h.startsWith(`${n} `))
  return result
}

/** Turns a spreadsheet matrix (first non-empty row = headers) into headers + data rows. */
export function splitMatrix(matrix: unknown[][]): { headers: string[]; rows: { row: number; cells: unknown[] }[] } {
  const isEmpty = (r: unknown[] | undefined) => !r || r.every((c) => c === null || c === undefined || String(c).trim() === '')
  const start = matrix.findIndex((r) => !isEmpty(r))
  if (start < 0) return { headers: [], rows: [] }
  const headers = matrix[start].map((h) => String(h ?? '').trim())
  const rows: { row: number; cells: unknown[] }[] = []
  for (let i = start + 1; i < matrix.length; i++) {
    if (isEmpty(matrix[i])) continue
    rows.push({ row: i + 1, cells: matrix[i] })
  }
  return { headers, rows }
}

/** Applies a column mapping to one row of cells. */
export function applyMapping(cells: unknown[], mapping: ImportTarget[]): RawRecord {
  const out: RawRecord = {}
  mapping.forEach((target, i) => {
    if (!target) return
    const v = cells[i]
    if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) return
    ;(out as Record<string, unknown>)[target] = v
  })
  return out
}

// ------------------------------------------------------------------
// Value parsing
// ------------------------------------------------------------------

const isBlank = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '')

/**
 * Lenient number: "S/ 1,250.50", "1.250,50", "25,5", "$30" → number.
 * Returns NaN when the text is not a number.
 */
export function parseNumber(v: unknown): number {
  if (typeof v === 'number') return v
  let s = String(v).trim().replace(/[^\d.,\-]/g, '').replace(/^[.,]+|[.,]+$/g, '')
  if (!s || s === '-') return NaN
  const lastDot = s.lastIndexOf('.')
  const lastComma = s.lastIndexOf(',')
  if (lastDot >= 0 && lastComma >= 0) {
    // Both present: the last one is the decimal separator.
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '')
  } else if (lastComma >= 0) {
    // "1,250" / "12,500,000" = thousands; "25,5" / "25,50" = decimals.
    s = /^-?\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.')
  } else if ((s.match(/\./g) ?? []).length > 1) {
    s = s.replace(/\./g, '') // "1.250.000"
  }
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : NaN
}

const TRUE = ['true', '1', 'si', 'sí', 'yes', 'y', 's', 'x', 'verdadero', 'activo', 'activa']
const FALSE = ['false', '0', 'no', 'n', 'falso', 'inactivo', 'inactiva']

/** true / false / undefined (unrecognized or blank). */
export function parseBool(v: unknown): boolean | undefined {
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  const s = String(v ?? '').trim().toLowerCase()
  if (TRUE.includes(s)) return true
  if (FALSE.includes(s)) return false
  return undefined
}

export function isPublicHttpUrl(s: string): boolean {
  try {
    const u = new URL(s)
    return (u.protocol === 'http:' || u.protocol === 'https:') && !!u.hostname
  } catch {
    return false
  }
}

function splitList(v: unknown, sep: RegExp): string[] {
  const list = Array.isArray(v) ? v : String(v).split(sep)
  return list.map((x) => String(x ?? '').trim()).filter(Boolean)
}

const text = (v: unknown, max: number) => String(v).trim().slice(0, max)

// ------------------------------------------------------------------
// Row normalization / validation
// ------------------------------------------------------------------

/**
 * Coerces and validates one raw record (from a mapped spreadsheet row,
 * the AI extractor or the import request). Used on both client and
 * server so the preview and the write agree.
 */
export function normalizeRow(raw: RawRecord, fields: AttributeField[], row: number): NormalizedRow {
  const errors: RowError[] = []
  const r = (raw ?? {}) as Record<string, unknown>
  const data: ImportRow = { name: isBlank(r.name) ? '' : text(r.name, 300) }
  if (!data.name) errors.push({ field: 'name', code: 'name_required' })

  if (!isBlank(r.description)) data.description = text(r.description, 4000)
  if (!isBlank(r.category)) data.category = text(r.category, 120)
  if (!isBlank(r.sku)) data.sku = text(r.sku, 100)

  for (const key of ['price', 'compare_at_price'] as const) {
    if (isBlank(r[key])) continue
    const n = parseNumber(r[key])
    if (!Number.isFinite(n)) errors.push({ field: key, code: 'number' })
    else if (n < 0) errors.push({ field: key, code: 'negative' })
    else data[key] = Math.round(n * 100) / 100
  }

  if (!isBlank(r.stock)) {
    const n = parseNumber(r.stock)
    if (!Number.isFinite(n)) errors.push({ field: 'stock', code: 'number' })
    else if (!Number.isInteger(n)) errors.push({ field: 'stock', code: 'integer' })
    else if (n < 0) errors.push({ field: 'stock', code: 'negative' })
    else data.stock = n
  }

  if (!isBlank(r.images)) {
    const urls = splitList(r.images, /\s*[|,\n]\s*|\s+(?=https?:\/\/)/)
    if (urls.some((u) => !isPublicHttpUrl(u))) errors.push({ field: 'images', code: 'url' })
    else if (urls.length > MAX_IMAGES) errors.push({ field: 'images', code: 'too_many' })
    else data.images = urls
  }

  if (!isBlank(r.tags)) {
    data.tags = [...new Set(splitList(r.tags, /[,;|]/).map((t) => t.slice(0, 50)))].slice(0, MAX_TAGS)
  }

  for (const key of ['is_featured', 'is_active'] as const) {
    if (isBlank(r[key])) continue
    const b = parseBool(r[key])
    if (b === undefined) errors.push({ field: key, code: 'boolean' })
    else data[key] = b
  }

  // Attributes: `attr:<key>` columns, plus a nested object or [{key, value}] list.
  const attrRaw: Record<string, unknown> = {}
  const nested = r.attributes
  if (Array.isArray(nested)) {
    for (const a of nested) if (a && typeof a === 'object' && 'key' in a) attrRaw[String((a as { key: unknown }).key)] = (a as { value: unknown }).value
  } else if (nested && typeof nested === 'object') {
    Object.assign(attrRaw, nested)
  }
  for (const [k, v] of Object.entries(r)) if (k.startsWith('attr:')) attrRaw[k.slice(5)] = v
  // Only validate fields that were provided: a missing column must not
  // trigger "required" on updates; creates are checked in planUpsert.
  const provided = fields.filter((f) => !isBlank(attrRaw[f.key]) && !(Array.isArray(attrRaw[f.key]) && (attrRaw[f.key] as unknown[]).length === 0))
  if (provided.length) {
    const { values, errors: attrErrors } = validateAttributes(provided, attrRaw)
    for (const [k, code] of Object.entries(attrErrors)) errors.push({ field: `attr:${k}`, code })
    if (Object.keys(values).length) data.attributes = values
  }

  return { row, data, errors }
}

// ------------------------------------------------------------------
// Upsert planning
// ------------------------------------------------------------------

export interface PlannedRow extends NormalizedRow {
  action: 'create' | 'update' | 'error'
  /** Existing product id for updates. */
  productId?: string
}

export interface ImportPlan {
  rows: PlannedRow[]
  creates: number
  updates: number
  errors: number
}

const skuKey = (s: string) => s.trim().toLowerCase()

/**
 * Decides create vs update for each row: a SKU that already exists in the
 * workspace updates that product (SKUs compare case-insensitively);
 * anything else creates. A SKU repeated in the file is an error after its
 * first occurrence, and new products must carry required attributes.
 */
export function planUpsert(
  rows: NormalizedRow[],
  existing: Map<string, string> | Record<string, string>,
  fields: AttributeField[] = [],
): ImportPlan {
  const lookup = new Map<string, string>()
  for (const [sku, id] of existing instanceof Map ? existing : Object.entries(existing)) lookup.set(skuKey(sku), id)
  const seen = new Set<string>()
  const required = fields.filter((f) => f.required)
  const out: PlannedRow[] = rows.map((r) => {
    const errors = [...r.errors]
    const sku = r.data.sku ? skuKey(r.data.sku) : ''
    if (sku) {
      if (seen.has(sku)) errors.push({ field: 'sku', code: 'sku_duplicate' })
      seen.add(sku)
    }
    const productId = sku ? lookup.get(sku) : undefined
    if (!productId) {
      for (const f of required) {
        if (r.data.attributes?.[f.key] === undefined && !errors.some((e) => e.field === `attr:${f.key}`)) {
          errors.push({ field: `attr:${f.key}`, code: 'required' })
        }
      }
    }
    if (errors.length) return { ...r, errors, action: 'error' as const }
    return productId ? { ...r, errors, action: 'update' as const, productId } : { ...r, errors, action: 'create' as const }
  })
  return {
    rows: out,
    creates: out.filter((r) => r.action === 'create').length,
    updates: out.filter((r) => r.action === 'update').length,
    errors: out.filter((r) => r.action === 'error').length,
  }
}

/** Distinct category names (case-insensitive, first spelling wins). */
export function categoryNames(rows: ImportRow[]): string[] {
  const seen = new Map<string, string>()
  for (const r of rows) {
    const name = r.category?.trim()
    if (name && !seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), name)
  }
  return [...seen.values()]
}

/**
 * Columns to write for a row. Creates get defaults; updates only touch
 * what the row provides (attributes merged over the current ones).
 */
export function productPayload(
  r: ImportRow,
  categoryId: string | null | undefined,
  mode: 'create' | 'update',
  currentAttributes?: Record<string, unknown> | null,
): Record<string, unknown> {
  const p: Record<string, unknown> = { name: r.name }
  const set = (k: string, v: unknown) => {
    if (v !== undefined) p[k] = v
  }
  set('description', r.description)
  set('price', r.price)
  set('compare_at_price', r.compare_at_price)
  set('sku', r.sku)
  if (r.stock !== undefined && r.stock !== null) {
    p.stock = r.stock
    p.track_stock = true
  }
  set('images', r.images)
  set('tags', r.tags)
  set('is_featured', r.is_featured)
  set('is_active', r.is_active)
  if (categoryId !== undefined) p.category_id = categoryId
  if (mode === 'update') {
    if (r.attributes) p.attributes = { ...(currentAttributes ?? {}), ...r.attributes }
  } else {
    p.attributes = r.attributes ?? {}
  }
  return p
}

/** Fixed template headers (in the UI locale) followed by attribute keys. */
export const TEMPLATE_HEADERS: Record<'es' | 'en', Record<FixedTarget, string>> = {
  es: {
    name: 'nombre', description: 'descripcion', price: 'precio', compare_at_price: 'precio anterior', sku: 'sku', stock: 'stock',
    category: 'categoria', images: 'imagenes', tags: 'etiquetas', is_featured: 'destacado', is_active: 'activo',
  },
  en: {
    name: 'name', description: 'description', price: 'price', compare_at_price: 'compare at price', sku: 'sku', stock: 'stock',
    category: 'category', images: 'images', tags: 'tags', is_featured: 'featured', is_active: 'active',
  },
}

/** Example value for an attribute column in the template. */
export function exampleAttributeValue(f: AttributeField, locale: 'es' | 'en'): string | number {
  switch (f.type) {
    case 'number':
      return 1
    case 'boolean':
      return 'no'
    case 'select':
      return f.options?.[0]?.label[locale] ?? ''
    case 'multiselect':
      return (f.options ?? []).slice(0, 2).map((o) => o.label[locale]).join(', ')
    default:
      return ''
  }
}

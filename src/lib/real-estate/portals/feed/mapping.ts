import type { AttributeField } from '@/lib/industries'
import { FIXED_TARGETS, MAX_IMAGES, isPublicHttpUrl, normalizeHeader, type FixedTarget } from '@/lib/catalog/import'
import { coerceAttributes, currencyFromPriceText, normalizeCurrency, parseAmount, type PortalListing } from '../values'
import type { FlatRecord, FlatValue } from './parse'

// Field mapping for agency feeds/files: which source path feeds which
// product column or attribute. Pure and client-safe (the preview in the
// browser and the import on the server use the same functions).

export const EXTRA_TARGETS = ['external_id', 'external_url', 'currency'] as const
export type ExtraTarget = (typeof EXTRA_TARGETS)[number]
export type FeedTarget = FixedTarget | ExtraTarget | `attr:${string}` | ''
/** source path → target */
export type FeedMapping = Record<string, FeedTarget>

const SYN: Partial<Record<FixedTarget | ExtraTarget, string[]>> = {
  external_id: ['id', 'codigo', 'codigo aviso', 'id aviso', 'idaviso', 'codigo propiedad', 'codigo inmueble', 'referencia', 'reference', 'reference code', 'ref', 'property id', 'listing id', 'external id', 'cod', 'codigo interno', 'aviso id', 'id propiedad'],
  name: ['titulo', 'title', 'publication title', 'nombre', 'titulo aviso', 'encabezado', 'headline', 'name'],
  description: ['descripcion', 'description', 'detalle', 'texto', 'descripcion aviso', 'rich description'],
  price: ['precio', 'price', 'valor', 'monto', 'precio venta', 'precio alquiler', 'importe', 'prices price', 'operations prices price', 'precio valor'],
  currency: ['moneda', 'currency', 'currency id', 'tipo moneda', 'divisa', 'precio moneda', 'prices currency', 'operations prices currency'],
  images: ['fotos', 'foto', 'imagenes', 'imagen', 'images', 'image', 'photos', 'photo', 'pictures', 'picture', 'url foto', 'fotos foto', 'imagenes imagen', 'photos image', 'pictures url', 'fotos url', 'multimedia foto', 'images image', 'photos original'],
  external_url: ['url', 'link', 'permalink', 'url aviso', 'enlace', 'url publicacion', 'public url', 'listing url'],
  category: ['categoria', 'category', 'proyecto', 'project'],
  tags: ['etiquetas', 'tags', 'palabras clave'],
  sku: [],
  is_active: ['activo', 'active', 'publicado', 'published', 'visible'],
}

const ATTR_SYN: Record<string, string[]> = {
  operation: ['operacion', 'tipo operacion', 'operation', 'operation type', 'operations operation type', 'transaccion', 'tipo de operacion', 'modalidad'],
  property_type: ['tipo propiedad', 'tipo inmueble', 'tipo de propiedad', 'tipo de inmueble', 'property type', 'type', 'type name', 'tipo', 'inmueble', 'subtipo', 'categoria inmueble'],
  bedrooms: ['dormitorios', 'habitaciones', 'recamaras', 'cuartos', 'bedrooms', 'suite amount', 'nro dormitorios', 'cantidad dormitorios', 'rooms bedrooms'],
  bathrooms: ['banos', 'bathrooms', 'bathroom amount', 'nro banos', 'cantidad banos', 'banos completos'],
  area_m2: ['area construida', 'area construida m2', 'area techada m2', 'area total m2', 'area techada', 'superficie construida', 'superficie cubierta', 'area', 'superficie', 'area total', 'superficie total', 'covered area', 'roofed surface', 'total surface', 'm2', 'metros cuadrados', 'area m2', 'surface'],
  parking: ['estacionamientos', 'cocheras', 'parking', 'parking lot amount', 'garages', 'cochera', 'estacionamiento', 'parking lots'],
  zone: ['distrito', 'zona', 'barrio', 'urbanizacion', 'neighborhood', 'location name', 'localidad', 'ubicacion distrito', 'location', 'ubicacion zona', 'district', 'sector'],
  address: ['direccion', 'address', 'calle', 'ubicacion direccion', 'real address', 'domicilio'],
  latitude: ['latitud', 'lat', 'latitude', 'geo lat', 'ubicacion latitud', 'location latitude', 'geolocalizacion latitud'],
  longitude: ['longitud', 'lng', 'lon', 'long', 'longitude', 'geo long', 'ubicacion longitud', 'location longitude', 'geolocalizacion longitud'],
  listing_status: ['estado', 'status', 'estado aviso', 'estado propiedad', 'situacion'],
  amenities: ['amenidades', 'amenities', 'caracteristicas', 'servicios', 'comodidades', 'tags name', 'features'],
  maintenance_fee: ['mantenimiento', 'cuota mantenimiento', 'expensas', 'expenses', 'gastos comunes', 'mantenimiento mensual', 'maintenance fee'],
  year_built: ['ano construccion', 'anio construccion', 'year built', 'ano de construccion', 'construccion'],
  floor: ['piso', 'floor', 'nro piso', 'numero piso', 'unit floor'],
  video_url: ['video', 'youtube', 'video url', 'videos', 'videos player url', 'url video'],
  virtual_tour_url: ['tour virtual', 'tour 360', 'virtual tour', 'recorrido virtual'],
}

const tokens = (path: string) => {
  const segs = path.split('/').map((s) => normalizeHeader(s.replace('@', ' ')))
  const last = segs[segs.length - 1] ?? ''
  return { full: normalizeHeader(path.replace(/[/@]/g, ' ')), last }
}

/**
 * Suggested target for each field path. Pass 1 matches the full path,
 * pass 2 the last segment; each target is used once (first path wins).
 */
export function guessFeedMapping(paths: string[], fields: AttributeField[]): FeedMapping {
  const candidates: { target: FeedTarget; names: string[] }[] = [
    ...EXTRA_TARGETS.map((t) => ({ target: t as FeedTarget, names: SYN[t] ?? [] })),
    ...FIXED_TARGETS.map((t) => ({ target: t as FeedTarget, names: SYN[t] ?? [] })),
    ...fields.map((f) => ({
      target: `attr:${f.key}` as FeedTarget,
      names: [...new Set([...(ATTR_SYN[f.key] ?? []), normalizeHeader(f.key.replace(/_/g, ' ')), normalizeHeader(f.label.es), normalizeHeader(f.label.en)])],
    })),
  ]
  const result: FeedMapping = {}
  const used = new Set<FeedTarget>()
  const pass = (pick: (p: string) => string) => {
    for (const p of paths) {
      if (result[p]) continue
      const key = pick(p)
      if (!key) continue
      const c = candidates.find((c) => !used.has(c.target) && c.names.some((n) => normalizeHeader(n) === key))
      if (c) {
        result[p] = c.target
        used.add(c.target)
      }
    }
  }
  pass((p) => tokens(p).full)
  pass((p) => tokens(p).last)
  return result
}

/** Keeps only valid targets for this workspace's fields. */
export function sanitizeMapping(input: unknown, fields: AttributeField[]): FeedMapping {
  const out: FeedMapping = {}
  if (!input || typeof input !== 'object') return out
  const valid = new Set<string>([...FIXED_TARGETS, ...EXTRA_TARGETS, ...fields.map((f) => `attr:${f.key}`)])
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (typeof k !== 'string' || k.length > 300 || typeof v !== 'string' || !valid.has(v)) continue
    out[k] = v as FeedTarget
  }
  return out
}

const first = (v: FlatValue | undefined) => (Array.isArray(v) ? v[0] : v)

/** One flat record + mapping → a listing (null when it has no external id). */
export function recordToListing(rec: FlatRecord, mapping: FeedMapping, fields: AttributeField[]): PortalListing | null {
  const raw: PortalListing['raw'] = {}
  const attrs: Record<string, unknown> = {}
  let externalId = ''
  let externalUrl: string | null = null
  let currency: string | null = null
  // Several paths may feed the same list target (e.g. photos + plans).
  const lists: Record<string, string[]> = {}

  for (const [path, target] of Object.entries(mapping)) {
    const v = rec[path]
    if (!target || v === undefined) continue
    if (target === 'external_id') externalId = String(first(v) ?? '').trim()
    else if (target === 'external_url') externalUrl = String(first(v) ?? '').trim() || null
    else if (target === 'currency') currency = normalizeCurrency(first(v))
    else if (target === 'images' || target === 'tags') (lists[target] ??= []).push(...(Array.isArray(v) ? v : [v]))
    else if (target.startsWith('attr:')) {
      const key = target.slice(5)
      const f = fields.find((x) => x.key === key)
      attrs[key] = f?.type === 'multiselect' ? (Array.isArray(v) ? v : String(v).split(/[,;|]/)) : v
    } else (raw as Record<string, unknown>)[target] = first(v)
  }
  if (lists.images) {
    // Photos: only http(s) URLs, at most the catalog limit (portals often carry 20+).
    const urls = lists.images.flatMap((v) => v.split(/\s*[|,\n]\s*|\s+(?=https?:\/\/)/)).map((u) => u.trim()).filter(isPublicHttpUrl)
    lists.images = [...new Set(urls)].slice(0, MAX_IMAGES)
  }
  for (const [k, list] of Object.entries(lists)) if (list.length) (raw as Record<string, unknown>)[k] = list
  if (!currency && raw.price !== undefined) currency = currencyFromPriceText(raw.price)
  for (const k of ['price', 'compare_at_price'] as const) {
    if (raw[k] === undefined) continue
    const n = parseAmount(raw[k])
    if (Number.isFinite(n)) raw[k] = n
  }
  if (!externalId) return null
  const coerced = coerceAttributes(attrs, fields)
  if (Object.keys(coerced).length) raw.attributes = coerced
  return { externalId: externalId.slice(0, 200), externalUrl, currency, raw }
}

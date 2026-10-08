import type { AttributeField } from '@/lib/industries'
import { normalizeHeader } from '@/lib/catalog/import'
import { MAX_IMAGES } from '@/lib/catalog/import'
import { coerceAttributes, normalizeOption, type PortalListing } from '../values'

// Mercado Libre item (GET /items/bulk body) → our real-estate listing.
// Attribute ids verified against GET /categories/MPE1474/attributes
// (Peru, Departamentos > Venta): OPERATION, PROPERTY_TYPE, BEDROOMS,
// FULL_BATHROOMS, COVERED_AREA, TOTAL_AREA, PARKING_LOTS,
// MAINTENANCE_FEE, PROPERTY_AGE, UNIT_FLOOR, HAS_* amenities...

export interface MlValueStruct {
  number?: number | null
  unit?: string | null
}
export interface MlAttribute {
  id: string
  name?: string
  value_id?: string | null
  value_name?: string | null
  value_struct?: MlValueStruct | null
  values?: { id?: string | null; name?: string | null; struct?: MlValueStruct | null }[]
}
interface MlPlace {
  id?: string | null
  name?: string | null
}
export interface MlLocation {
  address_line?: string | null
  zip_code?: string | null
  neighborhood?: MlPlace | null
  city?: MlPlace | null
  state?: MlPlace | null
  latitude?: number | string | null
  longitude?: number | string | null
}
export interface MlItem {
  id: string
  site_id?: string
  title?: string
  category_id?: string
  price?: number | null
  currency_id?: string | null
  status?: string
  permalink?: string | null
  pictures?: { id?: string; url?: string; secure_url?: string }[]
  video_id?: string | null
  attributes?: MlAttribute[]
  location?: MlLocation | null
  seller_address?: MlLocation | null
  geolocation?: { latitude?: number | null; longitude?: number | null } | null
}

/** Real-estate root categories (Inmuebles) per site. */
export const ML_REAL_ESTATE_ROOT: Record<string, string> = {
  MPE: 'MPE1459',
  MLA: 'MLA1459',
  MLM: 'MLM1459',
  MCO: 'MCO1459',
  MLC: 'MLC1459',
  MLU: 'MLU1459',
}

// Peru second-level categories (GET /categories/MPE1459) → property type.
const CATEGORY_TYPE: Record<string, string> = {
  MPE1466: 'house',
  MPE1472: 'apartment',
  MPE1478: 'commercial',
  MPE50556: 'office',
  MPE1493: 'land',
}
// OPERATION value ids (Peru): 242075 Venta, 242073 Alquiler, 242074 Alquiler temporal.
const OPERATION_IDS: Record<string, string> = { '242075': 'sale', '242073': 'rent', '242074': 'rent' }

const AMENITY_ATTRS: Record<string, string> = {
  HAS_SWIMMING_POOL: 'pool',
  HAS_GYM: 'gym',
  HAS_LIFT: 'elevator',
  HAS_TERRACE: 'terrace',
  HAS_GARDEN: 'garden',
  HAS_SECURITY: 'security_24h',
  HAS_PARTY_ROOM: 'common_areas',
  HAS_MULTIPURPOSE_ROOM: 'common_areas',
  HAS_GRILL: 'common_areas',
  HAS_PLAYGROUND: 'common_areas',
  HAS_ROOF_GARDEN: 'common_areas',
  FURNISHED: 'furnished',
  IS_SUITABLE_FOR_PETS: 'pet_friendly',
}

export function attr(item: MlItem, id: string): MlAttribute | undefined {
  return item.attributes?.find((a) => a.id === id)
}

const isYes = (a?: MlAttribute) => {
  const s = normalizeHeader(a?.value_name ?? a?.values?.[0]?.name ?? '')
  return s === 'si' || s === 'yes' || s === 'sim'
}

/** Numeric value of an attribute in square metres / units (null when absent). */
export function attrNumber(a: MlAttribute | undefined): number | null {
  if (!a) return null
  const struct = a.value_struct ?? a.values?.[0]?.struct ?? null
  let n: number | null = null
  let unit = struct?.unit ?? ''
  if (struct && typeof struct.number === 'number') n = struct.number
  else {
    const name = a.value_name ?? a.values?.[0]?.name ?? ''
    const m = /^\s*(-?\d+(?:[.,]\d+)?)\s*(.*)$/.exec(String(name))
    if (m) {
      n = Number(m[1].replace(',', '.'))
      unit = unit || m[2]
    }
  }
  if (n === null || !Number.isFinite(n)) return null
  if (/^ha$/i.test(unit.trim())) n = n * 10000
  return n
}

const attrText = (a?: MlAttribute) => (a?.value_name ?? a?.values?.[0]?.name ?? '').trim()

function youtubeUrl(videoId?: string | null): string | null {
  const v = (videoId ?? '').trim()
  if (!v) return null
  if (/^https?:\/\//.test(v)) return v
  return /^[A-Za-z0-9_-]{11}$/.test(v) ? `https://www.youtube.com/watch?v=${v}` : null
}

function coordinate(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) && n !== 0 ? n : null
}

/**
 * Maps one item (+ its plain-text description) to a listing for this
 * workspace's attribute fields. Unknown attributes are dropped later by
 * validateAttributes; listing_status is decided by the importer.
 */
export function mapMlItem(
  item: MlItem,
  description: string | null,
  fields: AttributeField[],
  opts: { now?: Date; parentCategoryId?: string | null } = {},
): PortalListing {
  const attrs: Record<string, unknown> = {}

  const op = attr(item, 'OPERATION')
  const opValue = (op?.value_id && OPERATION_IDS[op.value_id]) || normalizeOption('operation', attrText(op))
  if (opValue) attrs.operation = opValue

  const pt = normalizeOption('property_type', attrText(attr(item, 'PROPERTY_TYPE')))
  const typeFromCategory = CATEGORY_TYPE[opts.parentCategoryId ?? ''] ?? CATEGORY_TYPE[item.category_id ?? '']
  if (['house', 'apartment', 'land', 'office', 'commercial'].includes(pt)) attrs.property_type = pt
  else if (typeFromCategory) attrs.property_type = typeFromCategory

  const set = (key: string, n: number | null) => {
    if (n !== null) attrs[key] = n
  }
  set('bedrooms', attrNumber(attr(item, 'BEDROOMS')))
  set('bathrooms', attrNumber(attr(item, 'FULL_BATHROOMS')))
  set('area_m2', attrNumber(attr(item, 'COVERED_AREA')) ?? attrNumber(attr(item, 'TOTAL_AREA')))
  set('parking', attrNumber(attr(item, 'PARKING_LOTS')))
  set('maintenance_fee', attrNumber(attr(item, 'MAINTENANCE_FEE')))
  set('floor', attrNumber(attr(item, 'UNIT_FLOOR')))
  const age = attrNumber(attr(item, 'PROPERTY_AGE'))
  if (age !== null && age >= 0 && age < 300) attrs.year_built = (opts.now ?? new Date()).getFullYear() - Math.round(age)

  const amenities = new Set<string>()
  for (const [id, value] of Object.entries(AMENITY_ATTRS)) if (isYes(attr(item, id))) amenities.add(value)
  if (normalizeHeader(attrText(attr(item, 'SECURITY_TYPE'))) === '24 horas') amenities.add('security_24h')
  if (amenities.size) attrs.amenities = [...amenities]

  const loc = item.location ?? item.seller_address ?? null
  const zone = loc?.neighborhood?.name?.trim() || loc?.city?.name?.trim()
  if (zone) attrs.zone = zone
  const address = [loc?.address_line, loc?.neighborhood?.name, loc?.city?.name, loc?.state?.name]
    .map((s) => (s ?? '').trim())
    .filter((s, i, all) => s && all.indexOf(s) === i)
    .join(', ')
  if (address) attrs.address = address
  const lat = coordinate(loc?.latitude ?? item.geolocation?.latitude)
  const lng = coordinate(loc?.longitude ?? item.geolocation?.longitude)
  if (lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
    attrs.latitude = lat
    attrs.longitude = lng
  }
  const video = youtubeUrl(item.video_id)
  if (video) attrs.video_url = video

  const images = (item.pictures ?? [])
    .map((p) => p.secure_url || p.url || '')
    .filter((u) => /^https?:\/\//.test(u))
    .slice(0, MAX_IMAGES)

  const raw: PortalListing['raw'] = { name: (item.title ?? '').trim() || item.id }
  if (description?.trim()) raw.description = description.trim()
  if (typeof item.price === 'number' && item.price >= 0) raw.price = item.price
  if (images.length) raw.images = images
  const coerced = coerceAttributes(attrs, fields)
  if (Object.keys(coerced).length) raw.attributes = coerced

  return {
    externalId: item.id,
    externalUrl: item.permalink ?? null,
    currency: item.currency_id ?? null,
    raw,
  }
}

/** True when `pathFromRoot` (GET /categories/{id}.path_from_root) starts at a real-estate root. */
export function isRealEstateCategory(pathFromRoot: { id: string }[] | undefined | null): boolean {
  const rootId = pathFromRoot?.[0]?.id
  return !!rootId && Object.values(ML_REAL_ESTATE_ROOT).includes(rootId)
}

// Owner capture ("Captación") — pure logic shared by the server helpers,
// the API and the UI. Table: property_captures (migration 036).

import { getPreset, type Locale } from '@/lib/industries'
import { storagePathFromUrl } from '@/lib/storage/paths'

export const CAPTURE_STATUSES = ['new', 'contacted', 'evaluated', 'signed', 'rejected', 'published'] as const
export type CaptureStatus = (typeof CAPTURE_STATUSES)[number]
/** Statuses where a new AI capture from the same conversation updates the existing one. */
export const OPEN_CAPTURE_STATUSES: CaptureStatus[] = ['new', 'contacted', 'evaluated', 'signed']

export type CaptureOperation = 'sale' | 'rent'
export type CaptureSource = 'ai' | 'manual'

export interface PropertyCapture {
  id: string
  workspace_id: string
  contact_id: string | null
  conversation_id: string | null
  owner_name: string | null
  owner_phone: string | null
  operation: CaptureOperation | null
  property_type: string | null
  address: string | null
  district: string | null
  area_m2: number | null
  bedrooms: number | null
  bathrooms: number | null
  parking: number | null
  expected_price: number | null
  currency: string | null
  description: string | null
  photos: string[]
  status: CaptureStatus
  assigned_user_id: string | null
  notes: string | null
  source: CaptureSource
  product_id: string | null
  published_at: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

/** Editable fields (snake_case, as stored). */
export interface CaptureFields {
  owner_name?: string | null
  owner_phone?: string | null
  operation?: CaptureOperation | null
  property_type?: string | null
  address?: string | null
  district?: string | null
  area_m2?: number | null
  bedrooms?: number | null
  bathrooms?: number | null
  parking?: number | null
  expected_price?: number | null
  currency?: string | null
  description?: string | null
  photos?: string[]
  status?: CaptureStatus
  assigned_user_id?: string | null
  notes?: string | null
}

export function isCaptureStatus(v: unknown): v is CaptureStatus {
  return typeof v === 'string' && (CAPTURE_STATUSES as readonly string[]).includes(v)
}

const text = (v: unknown, max: number): string | null | undefined => {
  if (v === undefined) return undefined
  if (v === null) return null
  if (typeof v !== 'string' && typeof v !== 'number') return undefined
  const s = String(v).trim().replace(/[ \t]+/g, ' ')
  return s ? s.slice(0, max) : null
}

/** Number from a number or a localized string ("120", "120,5", "S/ 350,000", "1.200.000"). */
export function parseAmount(v: unknown): number | null | undefined {
  if (v === undefined) return undefined
  if (v === null || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN
  if (typeof v !== 'string') return NaN
  let s = v.replace(/[^\d.,-]/g, '')
  if (!s) return NaN
  const lastDot = s.lastIndexOf('.')
  const lastComma = s.lastIndexOf(',')
  if (lastDot >= 0 && lastComma >= 0) {
    // The last separator is the decimal one.
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '')
  } else if (lastComma >= 0) {
    // "350,000" (thousands) vs "85,5" (decimal)
    s = /,\d{3}(?:,|$)/.test(s) && !/,\d{1,2}$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.')
  } else if ((s.match(/\./g) ?? []).length > 1 || (/\.\d{3}$/.test(s) && s.indexOf('.') > 0 && s.length > 5)) {
    s = s.replace(/\./g, '')
  }
  const n = Number(s)
  return Number.isFinite(n) ? n : NaN
}

/** Maps free text ("depa", "Casa", "apartment") to a property_type option value of the preset. */
export function normalizePropertyType(v: unknown): string | null | undefined {
  const s = text(v, 60)
  if (s === undefined || s === null) return s
  const lc = s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  const field = getPreset('real_estate').productAttributes.find((f) => f.key === 'property_type')
  const byValue = field?.options?.find((o) => o.value === lc)
  if (byValue) return byValue.value
  const byLabel = field?.options?.find((o) =>
    Object.values(o.label).some((l) => l.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '') === lc),
  )
  if (byLabel) return byLabel.value
  const aliases: Record<string, string> = {
    depa: 'apartment', departamento: 'apartment', dpto: 'apartment', flat: 'apartment', piso: 'apartment', apartamento: 'apartment',
    casa: 'house', chalet: 'house', vivienda: 'house', lote: 'land', terreno: 'land', local: 'commercial', tienda: 'commercial',
    oficina: 'office',
  }
  for (const [k, val] of Object.entries(aliases)) if (lc.includes(k)) return val
  return s
}

export interface CaptureValidation {
  values: CaptureFields
  errors: Record<string, string>
}

/**
 * Validates and normalizes a partial capture (API bodies, AI output).
 * Unknown keys are dropped; `undefined` means "not provided".
 */
export function normalizeCaptureFields(raw: Record<string, unknown> | null | undefined): CaptureValidation {
  const r = raw ?? {}
  const values: CaptureFields = {}
  const errors: Record<string, string> = {}
  const setText = (k: keyof CaptureFields, max: number) => {
    const v = text(r[k], max)
    if (v !== undefined) (values as Record<string, unknown>)[k] = v
  }
  setText('owner_name', 120)
  setText('owner_phone', 40)
  setText('address', 300)
  setText('district', 120)
  setText('description', 4000)
  setText('notes', 4000)

  if (r.operation !== undefined) {
    const o = typeof r.operation === 'string' ? r.operation.trim().toLowerCase() : r.operation
    if (o === null || o === '') values.operation = null
    else if (o === 'sale' || o === 'venta' || o === 'vender') values.operation = 'sale'
    else if (o === 'rent' || o === 'alquiler' || o === 'renta' || o === 'alquilar') values.operation = 'rent'
    else errors.operation = 'invalid'
  }
  if (r.property_type !== undefined) values.property_type = normalizePropertyType(r.property_type) ?? null

  const numField = (k: 'area_m2' | 'bedrooms' | 'bathrooms' | 'parking' | 'expected_price', int: boolean, max: number) => {
    const n = parseAmount(r[k])
    if (n === undefined) return
    if (n === null) {
      values[k] = null
      return
    }
    if (!Number.isFinite(n) || n < 0 || n > max) {
      errors[k] = 'number'
      return
    }
    values[k] = int ? Math.round(n) : Math.round(n * 100) / 100
  }
  numField('area_m2', false, 10_000_000)
  numField('bedrooms', true, 1000)
  numField('bathrooms', true, 1000)
  numField('parking', true, 1000)
  numField('expected_price', false, 999_999_999_999)

  if (r.currency !== undefined) {
    const c = typeof r.currency === 'string' ? r.currency.trim().toUpperCase() : ''
    if (!c) values.currency = null
    else if (/^[A-Z]{3}$/.test(c)) values.currency = c
    else if (c === 'S/' || c === 'S/.' || c === 'SOLES') values.currency = 'PEN'
    else if (c === '$' || c === 'US$' || c === 'DOLARES' || c === 'DÓLARES') values.currency = 'USD'
    else errors.currency = 'invalid'
  }

  if (r.photos !== undefined) {
    if (!Array.isArray(r.photos)) errors.photos = 'invalid'
    else values.photos = normalizePhotoRefs(r.photos)
  }
  if (r.status !== undefined) {
    if (isCaptureStatus(r.status)) values.status = r.status
    else errors.status = 'invalid'
  }
  if (r.assigned_user_id !== undefined) {
    const a = r.assigned_user_id
    if (a === null || a === '') values.assigned_user_id = null
    else if (typeof a === 'string' && /^[0-9a-f-]{36}$/i.test(a)) values.assigned_user_id = a
    else errors.assigned_user_id = 'invalid'
  }
  return { values, errors }
}

// ------------------------------------------------------------------
// Photo references
// ------------------------------------------------------------------

/** Stored form of a private attachment photo (stable; signed on display). */
export const ATTACHMENTS_REF_PREFIX = 'sb://attachments/'
export const MAX_CAPTURE_PHOTOS = 30

export type PhotoRef =
  | { kind: 'attachment'; path: string }
  | { kind: 'catalog'; path: string; url: string }
  | { kind: 'proxy'; channelId: string; mediaId: string; url: string }
  | { kind: 'external'; url: string }

/**
 * Stable form of a photo reference. Signed attachment URLs expire (both
 * /api/files/attachments/… and legacy Supabase ones), so they are stored
 * as `sb://attachments/<path>`; WhatsApp proxy paths and http(s) URLs are
 * kept. Anything else returns null.
 */
export function normalizePhotoRef(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  if (!s || s.length > 2000) return null
  if (s.startsWith(ATTACHMENTS_REF_PREFIX)) return safePath(s.slice(ATTACHMENTS_REF_PREFIX.length)) ? s : null
  if (/^https?:\/\//i.test(s) || s.startsWith('/api/files/')) {
    const path = storagePathFromUrl(s, 'attachments')
    if (path) return safePath(path) ? ATTACHMENTS_REF_PREFIX + path : null
  }
  if (/^\/api\/media\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(s)) return s
  if (/^https?:\/\/[^\s]+$/i.test(s)) return s
  return null
}

function safePath(p: string): boolean {
  return !!p && !p.includes('..') && !p.startsWith('/') && /^[A-Za-z0-9/_.-]+$/.test(p)
}

export function normalizePhotoRefs(list: unknown[]): string[] {
  const out: string[] = []
  for (const v of list) {
    const r = normalizePhotoRef(v)
    if (r && !out.includes(r)) out.push(r)
    if (out.length >= MAX_CAPTURE_PHOTOS) break
  }
  return out
}

export function classifyPhotoRef(ref: string): PhotoRef | null {
  if (ref.startsWith(ATTACHMENTS_REF_PREFIX)) {
    const path = ref.slice(ATTACHMENTS_REF_PREFIX.length)
    return safePath(path) ? { kind: 'attachment', path } : null
  }
  const proxy = ref.match(/^\/api\/media\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)$/)
  if (proxy) return { kind: 'proxy', channelId: proxy[1], mediaId: proxy[2], url: ref }
  if (!/^https?:\/\//i.test(ref)) return null
  const path = storagePathFromUrl(ref, 'catalog')
  if (path) return { kind: 'catalog', path, url: ref }
  return { kind: 'external', url: ref }
}

// ------------------------------------------------------------------
// Publishing
// ------------------------------------------------------------------

const TITLES: Record<Locale, { type: Record<string, string>; property: string; sale: string; rent: string; in: string }> = {
  es: {
    type: { house: 'Casa', apartment: 'Departamento', land: 'Terreno', office: 'Oficina', commercial: 'Local comercial' },
    property: 'Propiedad',
    sale: 'en venta',
    rent: 'en alquiler',
    in: 'en',
  },
  en: {
    type: { house: 'House', apartment: 'Apartment', land: 'Land', office: 'Office', commercial: 'Retail space' },
    property: 'Property',
    sale: 'for sale',
    rent: 'for rent',
    in: 'in',
  },
}

/** "Departamento en venta en Miraflores" */
export function captureTitle(c: Pick<PropertyCapture, 'property_type' | 'operation' | 'district'>, locale: Locale): string {
  const T = TITLES[locale]
  const type = c.property_type ? (T.type[c.property_type] ?? c.property_type) : T.property
  const parts = [type.charAt(0).toUpperCase() + type.slice(1)]
  if (c.operation) parts.push(T[c.operation])
  if (c.district) parts.push(`${T.in} ${c.district}`)
  return parts.join(' ').slice(0, 200)
}

/** products.attributes for the listing created from a capture (validated later against the preset). */
export function captureAttributes(c: PropertyCapture): Record<string, unknown> {
  const a: Record<string, unknown> = { listing_status: 'available' }
  if (c.operation) a.operation = c.operation
  if (c.property_type) a.property_type = c.property_type
  if (c.bedrooms !== null) a.bedrooms = c.bedrooms
  if (c.bathrooms !== null) a.bathrooms = c.bathrooms
  if (c.area_m2 !== null) a.area_m2 = Number(c.area_m2)
  if (c.parking !== null) a.parking = c.parking
  if (c.district) a.zone = c.district
  if (c.address) a.address = c.address
  return a
}

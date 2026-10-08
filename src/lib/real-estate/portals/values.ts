import type { AttributeField } from '@/lib/industries'
import { normalizeHeader, parseNumber, type RawRecord } from '@/lib/catalog/import'

// Shared vocabulary for portal data (Mercado Libre, Urbania /
// Adondevivir exports, agency CRMs) → our real-estate attribute values.
// Pure and client-safe.

/** One listing from any source, ready for normalizeRow(). */
export interface PortalListing {
  /** Id in the source (required for re-import matching). */
  externalId: string
  externalUrl?: string | null
  /** ISO currency of `raw.price` when the source says it. */
  currency?: string | null
  raw: RawRecord & { attributes?: Record<string, unknown> }
}

const SYN: Record<string, Record<string, string[]>> = {
  operation: {
    sale: ['venta', 'vendo', 'sale', 'sell', 'for sale', 'compra', 'venta de inmueble', 'en venta'],
    rent: ['alquiler', 'alquiler temporal', 'alquiler temporario', 'arriendo', 'renta', 'rent', 'rental', 'for rent', 'lease', 'en alquiler', 'temporada'],
  },
  property_type: {
    apartment: ['departamento', 'departamentos', 'depa', 'dpto', 'apartamento', 'apartment', 'flat', 'duplex', 'dúplex', 'penthouse', 'loft', 'monoambiente', 'miniapartamento', 'triplex'],
    house: ['casa', 'casas', 'house', 'casa de playa', 'casa de campo', 'chalet', 'villa', 'casa en condominio', 'townhouse'],
    land: ['terreno', 'terrenos', 'lote', 'lotes', 'land', 'lot', 'terreno agricola', 'terreno urbano', 'parcela'],
    office: ['oficina', 'oficinas', 'office', 'consultorio'],
    commercial: ['local', 'local comercial', 'locales comerciales', 'locales', 'tienda', 'commercial', 'retail', 'almacen', 'almacén', 'deposito', 'depósito', 'nave industrial', 'galpon', 'galpón'],
  },
  listing_status: {
    available: ['disponible', 'available', 'activo', 'activa', 'active', 'publicado', 'published', 'en venta', 'en alquiler'],
    reserved: ['reservado', 'reservada', 'separado', 'separada', 'reserved', 'reserva'],
    sold: ['vendido', 'vendida', 'sold'],
    rented: ['alquilado', 'alquilada', 'rented', 'arrendado'],
    inactive: ['inactivo', 'inactiva', 'inactive', 'pausado', 'pausada', 'paused', 'despublicado'],
  },
  amenities: {
    pool: ['piscina', 'pool', 'swimming pool', 'alberca'],
    gym: ['gimnasio', 'gym'],
    elevator: ['ascensor', 'elevador', 'elevator', 'lift'],
    terrace: ['terraza', 'terrace', 'azotea'],
    garden: ['jardin', 'jardín', 'garden', 'area verde', 'áreas verdes'],
    garage: ['cochera', 'garage', 'garaje'],
    security_24h: ['seguridad 24h', 'seguridad 24 horas', 'vigilancia', 'seguridad', 'security', '24h security', 'guardiania'],
    common_areas: ['areas comunes', 'áreas comunes', 'common areas', 'zona de parrillas', 'parrilla', 'bbq', 'sala de usos multiples', 'salon de fiestas', 'juegos para ninos', 'roof garden', 'zona de juegos'],
    furnished: ['amoblado', 'amueblado', 'furnished'],
    pet_friendly: ['pet friendly', 'mascotas', 'admite mascotas', 'acepta mascotas', 'pets allowed'],
  },
}

/** Maps a portal word ("Depa", "Alquiler temporal") to our option value, or returns it unchanged. */
export function normalizeOption(key: string, value: unknown): string {
  const s = String(value ?? '').trim()
  const table = SYN[key]
  if (!table || !s) return s
  const n = normalizeHeader(s)
  for (const [target, words] of Object.entries(table)) {
    if (normalizeHeader(target) === n || words.some((w) => normalizeHeader(w) === n)) return target
  }
  // "Departamento en venta" / "Casa de playa en Asia": match a leading word.
  for (const [target, words] of Object.entries(table)) {
    if (words.some((w) => n.startsWith(`${normalizeHeader(w)} `))) return target
  }
  return s
}

/**
 * Like parseNumber, but "4.500" / "1.250.000" (dot thousands, common in
 * Peru) are thousands — prices and areas never carry 3 decimals.
 */
export function parseAmount(v: unknown): number {
  if (typeof v === 'number') return v
  const s = String(v ?? '').trim()
  const digits = s.replace(/[^\d.,-]/g, '')
  return /^-?\d{1,3}(\.\d{3})+$/.test(digits) ? Number(digits.replace(/\./g, '')) : parseNumber(s)
}

/** "120 m2", "120,5 m²", "1.250 mts" → number (NaN when not a number). */
export function parseMeasure(v: unknown): number {
  if (typeof v === 'number') return v
  const s = String(v ?? '')
    .replace(/\s*(m2|m²|mt2|mts2|mts|mt|metros cuadrados|metros|sqm|ha)\.?\s*$/i, '')
    .trim()
  return parseAmount(s)
}

/**
 * Prepares source attribute values for validateAttributes(): numbers
 * parsed leniently, select / multiselect words mapped to option values,
 * lists split. Keys not in `fields` are dropped.
 */
export function coerceAttributes(raw: Record<string, unknown>, fields: AttributeField[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of fields) {
    const v = raw[f.key]
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) continue
    switch (f.type) {
      case 'number': {
        const first = Array.isArray(v) ? v[0] : v
        const n = parseMeasure(first)
        out[f.key] = Number.isFinite(n) ? n : first
        break
      }
      case 'select':
        out[f.key] = normalizeOption(f.key, Array.isArray(v) ? v[0] : v)
        break
      case 'multiselect': {
        const list = (Array.isArray(v) ? v : String(v).split(/[,;|]/)).map((x) => normalizeOption(f.key, x)).filter(Boolean)
        const allowed = f.options?.map((o) => o.value)
        // Unknown amenities are dropped instead of failing the listing.
        const kept = allowed ? list.filter((x) => allowed.includes(x)) : list
        if (kept.length) out[f.key] = [...new Set(kept)]
        break
      }
      case 'boolean':
        out[f.key] = Array.isArray(v) ? v[0] : v
        break
      default:
        out[f.key] = Array.isArray(v) ? v.join(', ') : v
    }
  }
  return out
}

/** Option value `value` exists on the field (or the field has free values). */
export function fieldAccepts(fields: AttributeField[], key: string, value: string): boolean {
  const f = fields.find((x) => x.key === key)
  if (!f) return false
  return !f.options || f.options.some((o) => o.value === value)
}

const CURRENCY_WORDS: Record<string, string> = {
  's/': 'PEN', 's/.': 'PEN', 'soles': 'PEN', 'sol': 'PEN', pen: 'PEN',
  'us$': 'USD', $: 'USD', usd: 'USD', dolares: 'USD', 'dólares': 'USD', 'u$s': 'USD', dolar: 'USD',
}

/** "US$", "S/.", "dólares", "pen" → ISO code (null when unknown). */
export function normalizeCurrency(v: unknown): string | null {
  const s = String(v ?? '').trim().toLowerCase()
  if (!s) return null
  if (/^[a-z]{3}$/.test(s)) return s.toUpperCase()
  return CURRENCY_WORDS[s] ?? null
}

/** Currency hinted inside a price text ("US$ 150,000" → USD). */
export function currencyFromPriceText(v: unknown): string | null {
  const s = String(v ?? '').trim().toLowerCase()
  if (/^(us\$|u\$s|usd)/.test(s) || /usd$/.test(s)) return 'USD'
  if (/^(s\/|pen)/.test(s) || /(soles|pen)$/.test(s)) return 'PEN'
  return null
}

/**
 * products.currency for a listing priced in `currency` (migration 039):
 * null when it is the workspace currency (NULL = workspace currency),
 * the ISO code otherwise, undefined when the source didn't say (keeps
 * the stored value on update). Returns whether it is foreign too.
 */
export function listingCurrency(
  currency: string | null | undefined,
  workspaceCurrency: string,
): { currency: string | null | undefined; foreign: boolean } {
  const cur = normalizeCurrency(currency)
  if (!cur) return { currency: undefined, foreign: false }
  if (cur === workspaceCurrency.toUpperCase()) return { currency: null, foreign: false }
  return { currency: cur, foreign: true }
}

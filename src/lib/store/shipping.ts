// Shipping profiles of the online store. Pure: shared by the settings
// editor, the checkout (preview) and the server (the price that counts).

/** on_delivery: the store charges nothing; the customer pays the courier on delivery. */
export type ShippingType = 'free' | 'flat' | 'weight' | 'on_delivery'

export const SHIPPING_TYPES: ShippingType[] = ['free', 'flat', 'weight', 'on_delivery']

export interface WeightRate {
  /** Upper bound of the range in kg (inclusive); null = "and above". */
  up_to_kg: number | null
  price: number
}

export interface ShippingProfile {
  id: string
  name: string
  type: ShippingType
  flat_price: number | null
  rates: WeightRate[]
  free_over: number | null
  eta: string | null
  is_active: boolean
  sort_order: number
}

export type ShippingInput = Omit<ShippingProfile, 'id'>

const round2 = (n: number) => Math.round(n * 100) / 100
const money = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) && n >= 0 && n <= 1_000_000 ? round2(n) : NaN
}

export type ShippingError = 'name' | 'type' | 'flat_price' | 'rates' | 'rate_order' | 'free_over'

/** Editor input → a valid profile, or the field that is wrong. */
export function parseShippingInput(body: Record<string, unknown>): { ok: true; profile: ShippingInput } | { ok: false; error: ShippingError } {
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : ''
  if (!name) return { ok: false, error: 'name' }
  const type = body.type
  if (!SHIPPING_TYPES.includes(type as ShippingType)) return { ok: false, error: 'type' }

  let flat_price: number | null = null
  if (type === 'flat') {
    flat_price = money(body.flat_price)
    if (flat_price === null || Number.isNaN(flat_price)) return { ok: false, error: 'flat_price' }
  }

  let rates: WeightRate[] = []
  if (type === 'weight') {
    if (!Array.isArray(body.rates) || body.rates.length === 0 || body.rates.length > 20) return { ok: false, error: 'rates' }
    for (const r of body.rates as Record<string, unknown>[]) {
      const price = money(r?.price)
      const upRaw = r?.up_to_kg
      const up = upRaw === null || upRaw === undefined || upRaw === '' ? null : Number(upRaw)
      if (price === null || Number.isNaN(price)) return { ok: false, error: 'rates' }
      if (up !== null && (!Number.isFinite(up) || up <= 0 || up > 100_000)) return { ok: false, error: 'rates' }
      rates.push({ up_to_kg: up === null ? null : Math.round(up * 1000) / 1000, price })
    }
    // Ascending bounds; only the last range may be open ("and above").
    rates = [...rates]
    for (let i = 0; i < rates.length; i++) {
      const cur = rates[i].up_to_kg
      if (cur === null && i !== rates.length - 1) return { ok: false, error: 'rate_order' }
      if (i > 0 && cur !== null && (rates[i - 1].up_to_kg ?? Infinity) >= cur) return { ok: false, error: 'rate_order' }
    }
  }

  const free_over = type === 'free' || type === 'on_delivery' ? null : money(body.free_over)
  if (Number.isNaN(free_over)) return { ok: false, error: 'free_over' }

  const eta = typeof body.eta === 'string' && body.eta.trim() ? body.eta.trim().slice(0, 80) : null
  const sort = Number(body.sort_order)
  return {
    ok: true,
    profile: {
      name,
      type: type as ShippingType,
      flat_price,
      rates,
      free_over,
      eta,
      is_active: body.is_active !== false,
      sort_order: Number.isInteger(sort) ? Math.max(0, Math.min(1000, sort)) : 0,
    },
  }
}

/** Stored row (decimals as strings or numbers) → profile. */
export function toShippingProfile(row: {
  id: string
  name: string
  type: string
  flat_price: unknown
  rates: unknown
  free_over: unknown
  eta: string | null
  is_active: boolean
  sort_order: number
}): ShippingProfile {
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v))
  const rates = Array.isArray(row.rates)
    ? (row.rates as Record<string, unknown>[]).map((r) => ({ up_to_kg: r.up_to_kg === null || r.up_to_kg === undefined ? null : Number(r.up_to_kg), price: Number(r.price) || 0 }))
    : []
  return {
    id: row.id,
    name: row.name,
    type: (SHIPPING_TYPES.includes(row.type as ShippingType) ? row.type : 'flat') as ShippingType,
    flat_price: num(row.flat_price),
    rates,
    free_over: num(row.free_over),
    eta: row.eta,
    is_active: row.is_active,
    sort_order: row.sort_order,
  }
}

/** onDelivery: fee 0 here, paid to the courier on delivery. */
export type ShippingQuote = { ok: true; fee: number; freeReason: 'profile' | 'free_over' | null; onDelivery?: true } | { ok: false; reason: 'too_heavy' }

/**
 * Delivery fee of an order: free profiles cost 0, flat ones their price,
 * weight ones the price of the first range that holds the order's weight.
 * Orders whose subtotal reaches free_over ship free.
 */
export function quoteShipping(profile: Pick<ShippingProfile, 'type' | 'flat_price' | 'rates' | 'free_over'>, subtotal: number, weightKg: number): ShippingQuote {
  if (profile.type === 'free') return { ok: true, fee: 0, freeReason: 'profile' }
  if (profile.type === 'on_delivery') return { ok: true, fee: 0, freeReason: null, onDelivery: true }
  let fee: number
  if (profile.type === 'flat') fee = profile.flat_price ?? 0
  else {
    const w = Math.max(0, weightKg)
    const rate = profile.rates.find((r) => r.up_to_kg === null || w <= r.up_to_kg + 1e-9)
    if (!rate) return { ok: false, reason: 'too_heavy' }
    fee = rate.price
  }
  if (profile.free_over !== null && profile.free_over !== undefined && subtotal >= profile.free_over) return { ok: true, fee: 0, freeReason: 'free_over' }
  return { ok: true, fee: round2(fee), freeReason: null }
}

/** Order weight: each line's weight (variant first, then product; missing = 0) × quantity. */
export function orderWeight(lines: { weightKg: number | null; quantity: number }[]): number {
  return Math.round(lines.reduce((a, l) => a + (l.weightKg ?? 0) * l.quantity, 0) * 1000) / 1000
}

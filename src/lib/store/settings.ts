// Online store settings, stored in workspaces.settings.store. Pure.

export interface StoreSettings {
  /** The public store is published (only allowed when the store is ready). */
  enabled: boolean
  /** Short text under the store name. */
  tagline: string | null
  /** Wide image at the top of the store (public URL). */
  banner_url: string | null
  /** Main color of buttons and highlights (#rrggbb). */
  accent: string
  /** WhatsApp number for the "write to us" and "send proof" buttons (digits with country code). */
  whatsapp: string | null
  /** Customers may pick the order up instead of having it shipped. */
  pickup_enabled: boolean
  pickup_address: string | null
  /** Shown in the checkout, e.g. "Pedidos de lunes a sábado". */
  checkout_note: string | null
  /** Extra charges added to every order (or chosen by the customer). */
  fees: StoreFee[]
}

export const DEFAULT_ACCENT = '#059669'

export const DEFAULT_STORE_SETTINGS: StoreSettings = {
  enabled: false,
  tagline: null,
  banner_url: null,
  accent: DEFAULT_ACCENT,
  whatsapp: null,
  pickup_enabled: false,
  pickup_address: null,
  checkout_note: null,
  fees: [],
}

const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)

/** Stored value (anything) → complete settings. */
export function storeSettings(raw: unknown): StoreSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const accent = typeof r.accent === 'string' && /^#[0-9a-fA-F]{6}$/.test(r.accent) ? r.accent.toLowerCase() : DEFAULT_ACCENT
  const wa = typeof r.whatsapp === 'string' ? r.whatsapp.replace(/\D/g, '') : ''
  const banner = typeof r.banner_url === 'string' && /^https?:\/\//.test(r.banner_url) ? r.banner_url.slice(0, 2000) : null
  return {
    enabled: r.enabled === true,
    tagline: text(r.tagline, 160),
    banner_url: banner,
    accent,
    whatsapp: wa.length >= 8 && wa.length <= 15 ? wa : null,
    pickup_enabled: r.pickup_enabled === true,
    pickup_address: text(r.pickup_address, 240),
    checkout_note: text(r.checkout_note, 400),
    fees: parseFees(r.fees),
  }
}

export interface StoreReadiness {
  ordersModule: boolean
  shipping: boolean
  payment: boolean
  products: boolean
}

export type ReadinessKey = keyof StoreReadiness

/** What still blocks publishing the store (empty = it can be published). */
export function missingForStore(r: StoreReadiness): ReadinessKey[] {
  return (Object.keys(r) as ReadinessKey[]).filter((k) => !r[k])
}

/** Stored path of the public store. */
export function storePath(slug: string): string {
  return `/tienda/${encodeURIComponent(slug)}`
}

// ------------------------------------------------------------
// Extra charges (packaging, gift wrap…): a fixed amount per order
// ------------------------------------------------------------
export interface StoreFee {
  id: string
  name: string
  amount: number
  /** Always charged; otherwise the customer ticks it at checkout. */
  required: boolean
}

export const MAX_FEES = 5

export function parseFees(raw: unknown): StoreFee[] {
  if (!Array.isArray(raw)) return []
  const out: StoreFee[] = []
  const seen = new Set<string>()
  for (const [i, f] of (raw as Record<string, unknown>[]).entries()) {
    const name = typeof f?.name === 'string' ? f.name.trim().slice(0, 40) : ''
    const amount = Math.round(Number(f?.amount) * 100) / 100
    if (!name || !Number.isFinite(amount) || amount <= 0 || amount > 100_000) continue
    let id = typeof f?.id === 'string' && /^[a-z0-9]{1,16}$/i.test(f.id) ? f.id : `f${i}`
    while (seen.has(id)) id = `${id}x`
    seen.add(id)
    out.push({ id, name, amount, required: f?.required !== false })
    if (out.length >= MAX_FEES) break
  }
  return out
}

/** Charges of an order: the required ones plus the optional ones the customer picked. */
export function orderFees(fees: StoreFee[], picked: string[]): { lines: { name: string; amount: number }[]; total: number } {
  const lines = fees.filter((f) => f.required || picked.includes(f.id)).map((f) => ({ name: f.name, amount: f.amount }))
  return { lines, total: Math.round(lines.reduce((a, l) => a + l.amount, 0) * 100) / 100 }
}

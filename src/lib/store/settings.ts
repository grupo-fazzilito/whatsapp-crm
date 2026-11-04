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

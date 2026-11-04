// How the online store shows stock, and whether "Notify me" is offered on
// sold-out products. The store has a general rule (workspaces.settings.store)
// and each product may override it (products.stock_display,
// low_stock_threshold, waitlist_enabled; null = the general rule). Pure.

export const STOCK_DISPLAYS = ['hidden', 'exact', 'low'] as const
/** hidden = only "Sold out"; exact = "7 left"; low = "Almost gone" under the threshold. */
export type StockDisplay = (typeof STOCK_DISPLAYS)[number]

export const DEFAULT_STOCK_DISPLAY: StockDisplay = 'low'
export const DEFAULT_LOW_THRESHOLD = 5
export const MAX_LOW_THRESHOLD = 100_000

export interface StockRules {
  display: StockDisplay
  /** "Almost gone" when fewer than this many are left. */
  threshold: number
  /** "Notify me" on the sold-out product. */
  waitlist: boolean
}

export function parseStockDisplay(v: unknown): StockDisplay | null {
  return typeof v === 'string' && (STOCK_DISPLAYS as readonly string[]).includes(v) ? (v as StockDisplay) : null
}

export function parseThreshold(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN
  return Number.isInteger(n) && n >= 1 && n <= MAX_LOW_THRESHOLD ? n : null
}

export interface ProductStockOverrides {
  stock_display: string | null
  low_stock_threshold: number | null
  waitlist_enabled: boolean | null
}

/** The product's own rule where it has one, the store's otherwise. */
export function productStockRules(store: StockRules, p: ProductStockOverrides): StockRules {
  return {
    display: parseStockDisplay(p.stock_display) ?? store.display,
    threshold: parseThreshold(p.low_stock_threshold) ?? store.threshold,
    waitlist: typeof p.waitlist_enabled === 'boolean' ? p.waitlist_enabled : store.waitlist,
  }
}

/** What the store shows next to an available product (null = nothing). */
export type StockLabel = { kind: 'exact'; n: number; low: boolean } | { kind: 'low' } | null

/** `available`: units left, null = stock not tracked. */
export function stockLabel(rules: StockRules, available: number | null): StockLabel {
  if (available === null || available <= 0) return null
  const low = available < rules.threshold
  if (rules.display === 'exact') return { kind: 'exact', n: available, low }
  if (rules.display === 'low' && low) return { kind: 'low' }
  return null
}

/**
 * Stock the visitor's browser may know: the real number only when the store
 * shows it; otherwise 0 (sold out) or null (available, amount private).
 * The server checks the real stock when the order is placed.
 */
export function publicAvailable(rules: StockRules, available: number | null): number | null {
  if (available === null) return null
  if (available <= 0) return 0
  return rules.display === 'exact' ? available : null
}

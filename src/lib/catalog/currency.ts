import { COUNTRIES, formatMoney, moneyLocale } from '@/lib/workspace/countries'

// Per-product currency (migration 039). products.currency is an ISO 4217
// code or NULL = the workspace currency. Pure and client-safe.

/** Currencies offered in the catalog editor: the signup countries' + common extras. */
export const PRODUCT_CURRENCIES: string[] = [...new Set([...COUNTRIES.map((c) => c.currency), 'USD', 'EUR'])].sort()

const WORDS: Record<string, string> = {
  's/': 'PEN', 's/.': 'PEN', sol: 'PEN', soles: 'PEN', 'nuevos soles': 'PEN',
  'us$': 'USD', 'u$s': 'USD', dolar: 'USD', dolares: 'USD', 'dólar': 'USD', 'dólares': 'USD', dollar: 'USD', dollars: 'USD',
  '€': 'EUR', euro: 'EUR', euros: 'EUR',
  'r$': 'BRL', real: 'BRL', reales: 'BRL',
}

/**
 * ISO code from a cell / API value: "usd", "US$", "dólares", "S/." → code.
 * Null for blank or unknown values (a bare "$" is ambiguous and unknown).
 */
export function parseCurrency(v: unknown): string | null {
  const s = String(v ?? '').trim().toLowerCase()
  if (!s) return null
  if (/^[a-z]{3}$/.test(s)) return s.toUpperCase()
  return WORDS[s] ?? null
}

/** Currency a product is priced in: its own or the workspace's. */
export function effectiveCurrency(product: { currency?: string | null } | null | undefined, workspaceCurrency: string): string {
  return (product?.currency || workspaceCurrency || 'USD').toUpperCase()
}

/** True when the product is priced in a currency other than the workspace's. */
export function isForeignCurrency(product: { currency?: string | null } | null | undefined, workspaceCurrency: string): boolean {
  return effectiveCurrency(product, workspaceCurrency) !== (workspaceCurrency || 'USD').toUpperCase()
}

export interface MoneyWorkspace {
  currency: string
  locale?: string | null
  country?: string | null
}

/** Formats a product amount in the product's effective currency with the workspace locale. */
export function formatProductPrice(
  amount: number,
  product: { currency?: string | null } | null | undefined,
  ws: MoneyWorkspace,
  opts: { whole?: boolean } = {},
): string {
  return formatMoney(amount, effectiveCurrency(product, ws.currency), moneyLocale(ws), opts)
}

/**
 * Orders and carts are in the workspace currency only. Returns the
 * product's currency when it differs (the product can't go in a cart),
 * else null.
 */
export function cartCurrencyConflict(product: { currency?: string | null } | null | undefined, workspaceCurrency: string): string | null {
  return isForeignCurrency(product, workspaceCurrency) ? effectiveCurrency(product, workspaceCurrency) : null
}

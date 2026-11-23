// Sales regions: each has its currency, prices and payment gateway. The
// visitor's country (Cloudflare's CF-IPCountry) picks one; anyone outside
// Peru and Venezuela gets the US one. An account keeps the region it was
// created with (only the platform admin changes it), so a VPN can't switch
// prices. Pure — safe on the client.

export const REGIONS = ['pe', 've', 'us'] as const
export type Region = (typeof REGIONS)[number]

export const DEFAULT_REGION: Region = 'us'
/** Visitor's region (set by the proxy from the country, or by the country picker). */
export const REGION_COOKIE = 'region'
/** Cloudflare adds the visitor's ISO country (XX = unknown, T1 = Tor). */
export const COUNTRY_HEADER = 'cf-ipcountry'

export type Gateway = 'payment_latam' | 'mispidi' | 'paddle'

export interface RegionInfo {
  /** ISO 4217 of every price in this region. */
  currency: 'PEN' | 'USD'
  gateway: Gateway
  flag: string
  /** Country shown in the picker (same in every language). */
  country: string
}

export const REGION_INFO: Record<Region, RegionInfo> = {
  pe: { currency: 'PEN', gateway: 'payment_latam', flag: '🇵🇪', country: 'Perú' },
  ve: { currency: 'USD', gateway: 'mispidi', flag: '🇻🇪', country: 'Venezuela' },
  us: { currency: 'USD', gateway: 'paddle', flag: '🇺🇸', country: 'United States' },
}

export function isRegion(v: unknown): v is Region {
  return typeof v === 'string' && (REGIONS as readonly string[]).includes(v)
}

/** ISO country → region: Peru and Venezuela have their own, everyone else is US. */
export function regionForCountry(country: string | null | undefined): Region {
  const c = (country ?? '').trim().toUpperCase()
  if (c === 'PE') return 'pe'
  if (c === 'VE') return 've'
  return DEFAULT_REGION
}

/** "S/ 50", "US$ 0.015" — a price in the region's currency. */
export function formatMoney(amount: number, currency: string): string {
  const decimals = Number.isInteger(amount) ? 0 : Math.max(2, Math.min(4, (String(amount).split('.')[1] ?? '').length))
  const n = amount.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
  return currency === 'PEN' ? `S/ ${n}` : currency === 'USD' ? `US$ ${n}` : `${currency} ${n}`
}

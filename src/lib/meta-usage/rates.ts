// Estimated Meta charges for WhatsApp Business Platform messages
// (pricing in effect since Oct 1, 2026). Meta bills per delivered
// message by the recipient's country; we estimate with the business's
// country. Override with platform_settings 'meta_rates'
// ({ free_service_per_number?, rates?: { PE: {...}, other: {...} } }).
// Pure — safe in tests and on the client.

export interface MetaRates {
  service: number
  utility: number
  authentication: number
  marketing: number
}

/** Free service (non-template) messages per business phone number per month. */
export const FREE_SERVICE_PER_NUMBER = 1000

/** USD per delivered message. Sources: Meta rate cards as published by BSPs (Oct 2026). */
export const DEFAULT_META_RATES: Record<string, MetaRates> = {
  PE: { service: 0.03, utility: 0.03, authentication: 0.03, marketing: 0.0703 },
  MX: { service: 0.0085, utility: 0.0085, authentication: 0.0085, marketing: 0.0397 },
  BR: { service: 0.0068, utility: 0.0068, authentication: 0.0068, marketing: 0.0625 },
  other: { service: 0.0077, utility: 0.0077, authentication: 0.0077, marketing: 0.0604 },
}

export interface StoredMetaRates {
  free_service_per_number?: number
  rates?: Record<string, Partial<MetaRates>>
}

const pos = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null)

export function ratesFor(country: string | null | undefined, stored?: StoredMetaRates | null): { rates: MetaRates; market: string; freePerNumber: number } {
  const code = (country ?? '').toUpperCase()
  const market = stored?.rates?.[code] || DEFAULT_META_RATES[code] ? code : 'other'
  const base = DEFAULT_META_RATES[market] ?? DEFAULT_META_RATES.other
  const o = stored?.rates?.[market] ?? {}
  const rates: MetaRates = {
    service: pos(o.service) ?? base.service,
    utility: pos(o.utility) ?? base.utility,
    authentication: pos(o.authentication) ?? base.authentication,
    marketing: pos(o.marketing) ?? base.marketing,
  }
  const free = pos(stored?.free_service_per_number)
  return { rates, market, freePerNumber: free === null ? FREE_SERVICE_PER_NUMBER : Math.round(free) }
}

export interface NumberUsage {
  service: number
  marketing: number
  utility: number
  authentication: number
  other_template: number
}

export interface NumberEstimate {
  freeUsed: number
  freeLeft: number
  billableService: number
  /** USD by category. Unknown-category templates are priced as utility. */
  costUsd: { service: number; utility: number; authentication: number; marketing: number; total: number }
}

export function estimateNumber(u: NumberUsage, rates: MetaRates, freePerNumber: number): NumberEstimate {
  const freeUsed = Math.min(u.service, freePerNumber)
  const billableService = Math.max(0, u.service - freePerNumber)
  const service = billableService * rates.service
  const utility = (u.utility + u.other_template) * rates.utility
  const authentication = u.authentication * rates.authentication
  const marketing = u.marketing * rates.marketing
  const round = (n: number) => Math.round(n * 10_000) / 10_000
  return {
    freeUsed,
    freeLeft: freePerNumber - freeUsed,
    billableService,
    costUsd: {
      service: round(service),
      utility: round(utility),
      authentication: round(authentication),
      marketing: round(marketing),
      total: round(service + utility + authentication + marketing),
    },
  }
}

/** Month bounds in UTC for "YYYY-MM" (default: the month of `now`). */
export function monthBounds(month: string | null | undefined, now = new Date()): { month: string; since: Date; until: Date } | null {
  const m = month ?? `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(m)
  if (!match) return null
  const y = Number(match[1])
  const mo = Number(match[2]) - 1
  return { month: m, since: new Date(Date.UTC(y, mo, 1)), until: new Date(Date.UTC(y, mo + 1, 1)) }
}

/** Straight-line projection of the month's service messages. */
export function projectMonth(count: number, since: Date, until: Date, now = new Date()): number {
  const total = until.getTime() - since.getTime()
  const elapsed = Math.min(Math.max(now.getTime() - since.getTime(), 0), total)
  if (elapsed <= 0) return count
  if (elapsed >= total) return count
  return Math.round((count * total) / elapsed)
}

// Report settings live in workspaces.settings.reports:
//   { sla_minutes?: number, usd_rate?: number }
// usd_rate converts the internal AI cost (USD) to the workspace currency.

export const DEFAULT_SLA_MINUTES = 15
export const SLA_MIN = 1
export const SLA_MAX = 24 * 60
export const USD_RATE_MAX = 100_000

/** Sensible defaults per currency; unknown currencies show USD only. */
const DEFAULT_USD_RATES: Record<string, number> = { USD: 1, PEN: 3.75 }

export interface ReportSettings {
  slaMinutes: number
  /** Units of the workspace currency per 1 USD; null = not configured. */
  usdRate: number | null
}

export function validSla(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= SLA_MIN && v <= SLA_MAX
}

export function validUsdRate(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= USD_RATE_MAX
}

export function reportSettings(ws: { currency?: string | null; settings?: Record<string, unknown> | null }): ReportSettings {
  const raw = (ws.settings?.reports ?? {}) as { sla_minutes?: unknown; usd_rate?: unknown }
  const currency = (ws.currency ?? 'USD').toUpperCase()
  return {
    slaMinutes: validSla(raw.sla_minutes) ? raw.sla_minutes : DEFAULT_SLA_MINUTES,
    usdRate: validUsdRate(raw.usd_rate) ? raw.usd_rate : (DEFAULT_USD_RATES[currency] ?? null),
  }
}

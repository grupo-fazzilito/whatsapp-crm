import type { Localized } from '@/lib/industries/types'

export interface CountryInfo {
  code: string
  name: Localized
  currency: string
  timezone: string
  dialCode: string
}

// Countries offered at signup. Any ISO currency / IANA zone can still be
// set later in business settings.
export const COUNTRIES: CountryInfo[] = [
  { code: 'MX', name: { es: 'México', en: 'Mexico' }, currency: 'MXN', timezone: 'America/Mexico_City', dialCode: '52' },
  { code: 'CO', name: { es: 'Colombia', en: 'Colombia' }, currency: 'COP', timezone: 'America/Bogota', dialCode: '57' },
  { code: 'AR', name: { es: 'Argentina', en: 'Argentina' }, currency: 'ARS', timezone: 'America/Argentina/Buenos_Aires', dialCode: '54' },
  { code: 'CL', name: { es: 'Chile', en: 'Chile' }, currency: 'CLP', timezone: 'America/Santiago', dialCode: '56' },
  { code: 'PE', name: { es: 'Perú', en: 'Peru' }, currency: 'PEN', timezone: 'America/Lima', dialCode: '51' },
  { code: 'EC', name: { es: 'Ecuador', en: 'Ecuador' }, currency: 'USD', timezone: 'America/Guayaquil', dialCode: '593' },
  { code: 'GT', name: { es: 'Guatemala', en: 'Guatemala' }, currency: 'GTQ', timezone: 'America/Guatemala', dialCode: '502' },
  { code: 'CR', name: { es: 'Costa Rica', en: 'Costa Rica' }, currency: 'CRC', timezone: 'America/Costa_Rica', dialCode: '506' },
  { code: 'PA', name: { es: 'Panamá', en: 'Panama' }, currency: 'USD', timezone: 'America/Panama', dialCode: '507' },
  { code: 'DO', name: { es: 'República Dominicana', en: 'Dominican Republic' }, currency: 'DOP', timezone: 'America/Santo_Domingo', dialCode: '1' },
  { code: 'UY', name: { es: 'Uruguay', en: 'Uruguay' }, currency: 'UYU', timezone: 'America/Montevideo', dialCode: '598' },
  { code: 'BO', name: { es: 'Bolivia', en: 'Bolivia' }, currency: 'BOB', timezone: 'America/La_Paz', dialCode: '591' },
  { code: 'PY', name: { es: 'Paraguay', en: 'Paraguay' }, currency: 'PYG', timezone: 'America/Asuncion', dialCode: '595' },
  { code: 'VE', name: { es: 'Venezuela', en: 'Venezuela' }, currency: 'USD', timezone: 'America/Caracas', dialCode: '58' },
  { code: 'SV', name: { es: 'El Salvador', en: 'El Salvador' }, currency: 'USD', timezone: 'America/El_Salvador', dialCode: '503' },
  { code: 'HN', name: { es: 'Honduras', en: 'Honduras' }, currency: 'HNL', timezone: 'America/Tegucigalpa', dialCode: '504' },
  { code: 'NI', name: { es: 'Nicaragua', en: 'Nicaragua' }, currency: 'NIO', timezone: 'America/Managua', dialCode: '505' },
  { code: 'ES', name: { es: 'España', en: 'Spain' }, currency: 'EUR', timezone: 'Europe/Madrid', dialCode: '34' },
  { code: 'US', name: { es: 'Estados Unidos', en: 'United States' }, currency: 'USD', timezone: 'America/New_York', dialCode: '1' },
  { code: 'CA', name: { es: 'Canadá', en: 'Canada' }, currency: 'CAD', timezone: 'America/Toronto', dialCode: '1' },
  { code: 'BR', name: { es: 'Brasil', en: 'Brazil' }, currency: 'BRL', timezone: 'America/Sao_Paulo', dialCode: '55' },
  { code: 'IN', name: { es: 'India', en: 'India' }, currency: 'INR', timezone: 'Asia/Kolkata', dialCode: '91' },
]

export function countryDefaults(code: string | null | undefined): CountryInfo {
  return COUNTRIES.find((c) => c.code === code) ?? COUNTRIES.find((c) => c.code === 'US')!
}

/** Number/currency locale for a workspace: its language + country (es-PE → "S/ 55.00"). */
export function moneyLocale(ws: { locale?: string | null; country?: string | null }): string {
  const lang = ws.locale === 'en' ? 'en' : 'es'
  return ws.country ? `${lang}-${ws.country}` : lang === 'en' ? 'en-US' : 'es-MX'
}

/**
 * Format an amount in a currency (the workspace's or a product's own).
 * `whole` drops the cents of integer amounts ("S/ 450,000").
 * Spanish locales without a local dollar sign show "US$" (the usual
 * notation in Peru / Latin America) instead of the bare ISO code "USD".
 */
export function formatMoney(amount: number, currency: string, locale: string, opts: { whole?: boolean } = {}): string {
  try {
    const out = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      ...(opts.whole && Number.isInteger(amount) ? { maximumFractionDigits: 0 } : {}),
    }).format(amount)
    return currency === 'USD' && locale.startsWith('es') ? out.replace(/USD\s?/, 'US$ ') : out
  } catch {
    return `${currency} ${amount.toFixed(2)}`
  }
}

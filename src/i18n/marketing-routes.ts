import { LOCALES, isLocale, type AppLocale } from './config'

// Public (marketing) pages live under /es/... and /en/... so each language
// has its own indexable URL. Paths here are without the locale prefix.
export const MARKETING_PATHS = [
  '',
  '/features',
  '/pricing',
  '/integrations',
  '/ai-automation',
  '/shared-team-inbox',
  '/crm',
  '/analytics',
  '/whatsapp-marketing',
  '/enterprise',
  '/security',
  '/customer-stories',
  '/blog',
  '/about',
  '/about-us',
  '/careers',
  '/contact',
  '/contact-us',
  '/book-demo',
  '/api-docs',
  '/privacy-policy',
  '/refund-policy',
  '/terms-and-conditions',
  '/terms-of-service',
  '/data-deletion',
] as const

const SET = new Set<string>(MARKETING_PATHS)

/** `/features` → true; `/` counts as the home page. */
export function isMarketingPath(path: string): boolean {
  return SET.has(path === '/' ? '' : path.replace(/\/+$/, ''))
}

/** Splits `/en/pricing` into `{ locale: 'en', path: '/pricing' }`; null when not prefixed. */
export function splitLocale(pathname: string): { locale: AppLocale; path: string } | null {
  const m = /^\/([a-z]{2})(\/.*)?$/.exec(pathname)
  if (!m || !isLocale(m[1])) return null
  const path = (m[2] ?? '').replace(/\/+$/, '')
  return { locale: m[1], path }
}

/** `/pricing` in `en` → `/en/pricing`; home → `/en`. */
export function localizedPath(locale: AppLocale, path: string): string {
  const clean = path === '/' ? '' : path
  return `/${locale}${clean}`
}

/** hreflang map for one page (relative URLs; metadataBase makes them absolute). */
export function languageAlternates(path: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const l of LOCALES) out[l] = localizedPath(l, path)
  out['x-default'] = localizedPath('es', path)
  return out
}

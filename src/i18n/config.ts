export const LOCALES = ['es', 'en'] as const
export type AppLocale = (typeof LOCALES)[number]
export const DEFAULT_LOCALE: AppLocale = 'es'
export const LOCALE_COOKIE = 'locale'

export function isLocale(v: unknown): v is AppLocale {
  return typeof v === 'string' && (LOCALES as readonly string[]).includes(v)
}

/** Best match from an Accept-Language header. */
export function negotiateLocale(acceptLanguage: string | null | undefined): AppLocale {
  for (const part of (acceptLanguage ?? '').split(',')) {
    const lang = part.trim().slice(0, 2).toLowerCase()
    if (isLocale(lang)) return lang
  }
  return DEFAULT_LOCALE
}

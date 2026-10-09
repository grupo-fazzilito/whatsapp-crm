import 'server-only'
import { cookies, headers } from 'next/headers'
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale, type AppLocale } from './config'
import { createTranslator } from './translate'

/**
 * Language of the request: the URL prefix on public pages (/es, /en, set
 * by the proxy as x-locale), otherwise the visitor's choice (locale
 * cookie); Spanish until they pick English.
 */
export async function getLocale(): Promise<AppLocale> {
  const fromUrl = (await headers()).get('x-locale')
  if (isLocale(fromUrl)) return fromUrl
  const c = (await cookies()).get(LOCALE_COOKIE)?.value
  return isLocale(c) ? c : DEFAULT_LOCALE
}

export async function getT() {
  return createTranslator(await getLocale())
}

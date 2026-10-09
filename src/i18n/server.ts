import 'server-only'
import { cookies } from 'next/headers'
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale, type AppLocale } from './config'
import { createTranslator } from './translate'

/** The visitor's choice (locale cookie); Spanish until they pick English. */
export async function getLocale(): Promise<AppLocale> {
  const c = (await cookies()).get(LOCALE_COOKIE)?.value
  return isLocale(c) ? c : DEFAULT_LOCALE
}

export async function getT() {
  return createTranslator(await getLocale())
}

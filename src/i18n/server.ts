import 'server-only'
import { cookies, headers } from 'next/headers'
import { LOCALE_COOKIE, isLocale, negotiateLocale, type AppLocale } from './config'
import { createTranslator } from './translate'

export async function getLocale(): Promise<AppLocale> {
  const c = (await cookies()).get(LOCALE_COOKIE)?.value
  if (isLocale(c)) return c
  return negotiateLocale((await headers()).get('accept-language'))
}

export async function getT() {
  return createTranslator(await getLocale())
}

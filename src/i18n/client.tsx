'use client'

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { LOCALE_COOKIE, type AppLocale } from './config'
import { createTranslator, type Translator } from './translate'

interface I18nValue {
  locale: AppLocale
  t: Translator
  setLocale: (l: AppLocale) => void
}

const I18nContext = createContext<I18nValue | null>(null)

export function I18nProvider({ locale: initial, children }: { locale: AppLocale; children: ReactNode }) {
  const [locale, setLocaleState] = useState<AppLocale>(initial)
  const setLocale = useCallback((l: AppLocale) => {
    document.cookie = `${LOCALE_COOKIE}=${l}; path=/; max-age=31536000; samesite=lax`
    setLocaleState(l)
    document.documentElement.lang = l
  }, [])
  const value = useMemo(() => ({ locale, t: createTranslator(locale), setLocale }), [locale, setLocale])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext)
  if (ctx) return ctx
  return { locale: 'es', t: createTranslator('es'), setLocale: () => {} }
}

export function useT(): Translator {
  return useI18n().t
}

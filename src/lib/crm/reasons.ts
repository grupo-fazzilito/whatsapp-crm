// Lost reasons for deals. Configurable per workspace in
// workspaces.settings.crm.lost_reasons (string[]); defaults below.

export const DEFAULT_LOST_REASONS: Record<'es' | 'en', string[]> = {
  es: ['Precio', 'Eligió a la competencia', 'Sin respuesta', 'No era el momento', 'Otro'],
  en: ['Price', 'Chose a competitor', 'No response', 'Bad timing', 'Other'],
}

export const MAX_LOST_REASONS = 20
export const MAX_REASON_LENGTH = 80

/** Trims, drops empties/duplicates (case-insensitive) and caps the list. */
export function normalizeReasons(list: unknown): string[] {
  if (!Array.isArray(list)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of list) {
    if (typeof raw !== 'string') continue
    const r = raw.trim().replace(/\s+/g, ' ').slice(0, MAX_REASON_LENGTH)
    const key = r.toLocaleLowerCase()
    if (!r || seen.has(key)) continue
    seen.add(key)
    out.push(r)
    if (out.length >= MAX_LOST_REASONS) break
  }
  return out
}

type SettingsLike = { crm?: unknown; [key: string]: unknown } | null | undefined

/** The workspace's configured reasons, or the defaults for `locale`. */
export function lostReasons(settings: SettingsLike, locale: string = 'es'): string[] {
  const crm = (settings?.crm ?? null) as { lost_reasons?: unknown } | null
  const custom = normalizeReasons(crm?.lost_reasons)
  if (custom.length) return custom
  return DEFAULT_LOST_REASONS[locale === 'en' ? 'en' : 'es']
}

/** Whether `reason` is the catch-all "Otro"/"Other" option (asks for details). */
export function isOtherReason(reason: string): boolean {
  return /^(otro|otra|other)s?$/i.test(reason.trim())
}

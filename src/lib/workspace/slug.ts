// The workspace slug: the business's public address (/tienda/<slug>,
// /p/<slug>/<property>). Pure — shared by the form and the server.

export const SLUG_MIN = 3
export const SLUG_MAX = 50

/** Words a business cannot take as its address. */
const RESERVED = new Set(['admin', 'api', 'app', 'www', 'whasalia', 'soporte', 'support', 'ayuda', 'help', 'tienda', 'store', 'login', 'static', 'test'])

/** "Barbería Léo & Co." → "barberia-leo-co" (letters, digits and single dashes). */
export function normalizeSlug(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/, '')
}

export type SlugProblem = 'short' | 'long' | 'format' | 'reserved'

/** Why `slug` cannot be an address, or null when it can (availability is checked apart). */
export function slugProblem(slug: string): SlugProblem | null {
  if (slug.length < SLUG_MIN) return 'short'
  if (slug.length > SLUG_MAX) return 'long'
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return 'format'
  if (RESERVED.has(slug)) return 'reserved'
  return null
}

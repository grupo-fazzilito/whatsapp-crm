// Public changelog shown at /es/changelog and /en/changelog. Newest first.
// Add an entry with every user-visible change (one per release / PR).

export type ChangeKind = 'new' | 'improved' | 'fixed'

export interface ChangelogEntry {
  /** YYYY-MM-DD */
  date: string
  title: { es: string; en: string }
  changes: { kind: ChangeKind; es: string; en: string }[]
}

// Paused until the platform is fully in production (docs/PENDIENTES.md).
// While empty, the page answers 404 and the footer and sitemap leave it out.
export const CHANGELOG: ChangelogEntry[] = []

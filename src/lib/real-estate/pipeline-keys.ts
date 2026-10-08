// Stable stage keys of the real-estate sales pipeline (pipeline_stages.key,
// migration 036). Use these to move deals, never the stage names (users
// can rename stages).

export const REAL_ESTATE_PIPELINE_KEY = 'real_estate'

export const REAL_ESTATE_STAGE_KEYS = [
  'new',
  'qualified',
  'viewing_scheduled',
  'viewed',
  'negotiation',
  'reservation',
  'won',
] as const

export type RealEstateStageKey = (typeof REAL_ESTATE_STAGE_KEYS)[number]

export function isRealEstateStageKey(v: unknown): v is RealEstateStageKey {
  return typeof v === 'string' && (REAL_ESTATE_STAGE_KEYS as readonly string[]).includes(v)
}

/** Index of a stage in the funnel (higher = further along), -1 if unknown. */
export function stageRank(key: string | null | undefined): number {
  return key ? (REAL_ESTATE_STAGE_KEYS as readonly string[]).indexOf(key) : -1
}

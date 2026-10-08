import { PRIORITIES, type Priority } from './types'

const RANK: Record<Priority, number> = { urgent: 3, high: 2, normal: 1, low: 0 }

export function isPriority(v: unknown): v is Priority {
  return typeof v === 'string' && (PRIORITIES as readonly string[]).includes(v)
}

/** Unknown / missing values count as 'normal'. */
export function priorityOf(v: unknown): Priority {
  return isPriority(v) ? v : 'normal'
}

export function priorityRank(v: unknown): number {
  return RANK[priorityOf(v)]
}

/** Display order for pickers: most urgent first. */
export const PRIORITY_ORDER: Priority[] = ['urgent', 'high', 'normal', 'low']

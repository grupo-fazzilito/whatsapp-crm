// Query parameters of GET /api/backup (pure, so it's testable).
import { parseDatasets, type Dataset } from './datasets-format'
import type { BackupLang } from './messages-format'

const DAY = /^\d{4}-\d{2}-\d{2}$/

/** A real calendar day "YYYY-MM-DD" (not 2026-02-31). */
export function isDay(v: string): boolean {
  if (!DAY.test(v)) return false
  const [y, m, d] = v.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10) === v
}

export function nextDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10)
}

export interface BackupParams {
  datasets: Dataset[]
  from: string | null
  to: string | null
  includeInternal: boolean
  /** null = not asked: use the business's language. */
  lang: BackupLang | null
}

export type ParamsResult = { ok: true; params: BackupParams } | { ok: false; error: 'invalid_datasets' | 'invalid_dates' | 'invalid_params' }

const KNOWN = new Set(['datasets', 'from', 'to', 'internal', 'lang'])

export function parseBackupParams(q: URLSearchParams): ParamsResult {
  for (const k of q.keys()) if (!KNOWN.has(k) || q.getAll(k).length > 1) return { ok: false, error: 'invalid_params' }
  const datasets = parseDatasets(q.get('datasets'))
  if (!datasets) return { ok: false, error: 'invalid_datasets' }
  const from = q.get('from') || null
  const to = q.get('to') || null
  if ((from && !isDay(from)) || (to && !isDay(to)) || (from && to && from > to)) return { ok: false, error: 'invalid_dates' }
  const internal = q.get('internal')
  if (internal !== null && internal !== '0' && internal !== '1') return { ok: false, error: 'invalid_params' }
  const lang = q.get('lang')
  if (lang !== null && lang !== 'es' && lang !== 'en') return { ok: false, error: 'invalid_params' }
  return { ok: true, params: { datasets, from, to, includeInternal: internal === '1', lang } }
}

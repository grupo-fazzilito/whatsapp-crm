import 'server-only'
import { downloadFeed } from '@/lib/real-estate/portals/feed/import'
import { FeedError, MAX_FEED_ITEMS, collectFields, parseFeed, type FlatRecord, type ParsedFeed } from '@/lib/real-estate/portals/feed/parse'

export const MAX_TEXT_CHARS = 15 * 1024 * 1024
const PORTALS = ['urbania', 'adondevivir', 'mercadolibre', 'own_crm', 'other'] as const
const FORMATS = ['auto', 'xml', 'json', 'csv'] as const

export interface FeedInput {
  name: string
  portal: (typeof PORTALS)[number]
  url: string
  format: (typeof FORMATS)[number]
  item_path: string | null
  schedule: 'manual' | 'daily'
  deactivate_missing: boolean
}

export function isHttpUrl(s: unknown): s is string {
  if (typeof s !== 'string' || s.length > 2000) return false
  try {
    const u = new URL(s)
    return (u.protocol === 'http:' || u.protocol === 'https:') && !!u.hostname && !u.username && !u.password
  } catch {
    return false
  }
}

/** Validates feed fields (all when `partial` is false). */
export function parseFeedInput(body: Record<string, unknown>, partial: boolean): { ok: true; value: Partial<FeedInput> } | { ok: false; error: string } {
  const v: Partial<FeedInput> = {}
  if ('name' in body || !partial) {
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name || name.length > 120) return { ok: false, error: 'name' }
    v.name = name
  }
  if ('portal' in body) {
    if (!PORTALS.includes(body.portal as FeedInput['portal'])) return { ok: false, error: 'portal' }
    v.portal = body.portal as FeedInput['portal']
  }
  if ('url' in body || !partial) {
    if (!isHttpUrl(body.url)) return { ok: false, error: 'url' }
    v.url = body.url
  }
  if ('format' in body) {
    if (!FORMATS.includes(body.format as FeedInput['format'])) return { ok: false, error: 'format' }
    v.format = body.format as FeedInput['format']
  }
  if ('item_path' in body) {
    const p = body.item_path
    if (p !== null && (typeof p !== 'string' || p.length > 300)) return { ok: false, error: 'item_path' }
    v.item_path = (p as string | null) || null
  }
  if ('schedule' in body) {
    if (body.schedule !== 'manual' && body.schedule !== 'daily') return { ok: false, error: 'schedule' }
    v.schedule = body.schedule
  }
  if ('deactivate_missing' in body) {
    if (typeof body.deactivate_missing !== 'boolean') return { ok: false, error: 'deactivate_missing' }
    v.deactivate_missing = body.deactivate_missing
  }
  return { ok: true, value: v }
}

/** Records already parsed in the browser (Excel): validated shape. */
function recordsInput(raw: unknown): FlatRecord[] | null {
  if (!Array.isArray(raw)) return null
  if (raw.length > MAX_FEED_ITEMS) throw new FeedError('too_many')
  return raw.map((r) => {
    const rec: FlatRecord = {}
    if (r && typeof r === 'object') {
      for (const [k, v] of Object.entries(r as Record<string, unknown>)) {
        if (k.length > 300) continue
        if (Array.isArray(v)) rec[k] = v.map((x) => String(x ?? '').slice(0, 5000))
        else if (v !== null && v !== undefined && String(v).trim() !== '') rec[k] = String(v).slice(0, 10000)
      }
    }
    return rec
  })
}

/** Body {url} | {text, format?} | {records} → parsed feed. */
export async function parsedFromBody(body: Record<string, unknown>): Promise<ParsedFeed> {
  const format = typeof body.format === 'string' ? body.format : null
  const itemPath = typeof body.item_path === 'string' ? body.item_path : null
  const records = recordsInput(body.records)
  if (records) {
    const nonEmpty = records.filter((r) => Object.keys(r).length)
    if (!nonEmpty.length) throw new FeedError('no_items')
    return { format: 'csv', itemPath: '', records: nonEmpty, fields: collectFields(nonEmpty) }
  }
  if (typeof body.text === 'string') {
    if (body.text.length > MAX_TEXT_CHARS) throw new FeedError('too_many')
    return parseFeed(body.text, { format, itemPath })
  }
  if (isHttpUrl(body.url)) return parseFeed(await downloadFeed(body.url), { format, itemPath })
  throw new FeedError('empty')
}

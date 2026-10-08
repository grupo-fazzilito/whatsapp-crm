import 'server-only'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { productAttributesFor } from '@/lib/catalog/attributes'
import { FetchBlockedError, decodeText, safeFetch } from '../net'
import { finishRun, loadWorkspace, portalDevFlags, startRun, writeListings, type ImportSummary, type RunTrigger } from '../sync'
import type { PortalListing } from '../values'
import { recordToListing, sanitizeMapping, type FeedMapping } from './mapping'
import { FeedError, parseFeed, type FlatRecord, type ParsedFeed } from './parse'

// Feeds and files exported by the agency itself (its CRM, website or the
// export a portal gives the advertiser). We only read data the agency
// owns and points us to — never portal web pages.

export const MAX_FEED_BYTES = 15 * 1024 * 1024

export interface FeedRow {
  id: string
  workspace_id: string
  name: string
  portal: string
  url: string
  format: 'auto' | 'xml' | 'json' | 'csv'
  mapping: FeedMapping
  item_path: string | null
  schedule: 'manual' | 'daily'
  deactivate_missing: boolean
  last_run_at: string | null
}

export const feedSource = (feedId: string) => `feed:${feedId}`
export const fileSource = (label: string) => `file:${label.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').slice(0, 60) || 'file'}`

export async function downloadFeed(url: string): Promise<string> {
  const { allowPrivateHosts } = await portalDevFlags()
  const res = await safeFetch(url, {
    maxBytes: MAX_FEED_BYTES,
    timeoutMs: 45_000,
    allowPrivate: allowPrivateHosts,
    accept: 'application/xml, text/xml, application/json, text/csv, */*',
  })
  return decodeText(res.bytes, res.contentType)
}

export function feedErrorCode(e: unknown): string {
  if (e instanceof FeedError) return `feed_${e.code}`
  if (e instanceof FetchBlockedError) return `fetch_${e.code}`
  return e instanceof Error ? e.message.slice(0, 200) : String(e)
}

/** Records → listings; rows without an external id are reported, not imported. */
export function toListings(records: FlatRecord[], mapping: FeedMapping, fields: Parameters<typeof recordToListing>[2]) {
  const listings: PortalListing[] = []
  let withoutId = 0
  for (const r of records) {
    const l = recordToListing(r, mapping, fields)
    if (l) listings.push(l)
    else withoutId++
  }
  return { listings, withoutId }
}

export interface FeedImportResult {
  runId: string
  summary: ImportSummary | null
  error?: string
  withoutId?: number
}

async function runParsed(
  workspaceId: string,
  run: { source: 'feed' | 'file'; feedId?: string | null; trigger: RunTrigger; userId?: string | null },
  getParsed: () => Promise<ParsedFeed>,
  mappingInput: unknown,
  externalSource: string,
  deactivateMissing: boolean,
): Promise<FeedImportResult> {
  const runId = await startRun(workspaceId, run.source, { feedId: run.feedId, trigger: run.trigger, userId: run.userId })
  try {
    const ws = await loadWorkspace(workspaceId)
    if (!ws) throw new Error('workspace not found')
    const fields = productAttributesFor(ws.industry, ws.settings)
    const mapping = sanitizeMapping(mappingInput, fields)
    if (!Object.values(mapping).includes('external_id')) throw new Error('mapping_external_id')
    const parsed = await getParsed()
    const { listings, withoutId } = toListings(parsed.records, mapping, fields)
    const summary = await writeListings({ workspace: ws, externalSource, listings, deactivateMissing, userId: run.userId })
    if (withoutId) {
      summary.failed += withoutId
      summary.total += withoutId
      summary.errors.push({ ref: '-', error: `external_id: required (${withoutId})` })
    }
    await finishRun(runId, summary)
    return { runId, summary, withoutId }
  } catch (e) {
    const msg = feedErrorCode(e)
    await finishRun(runId, null, msg)
    return { runId, summary: null, error: msg }
  }
}

export async function importFeed(feed: FeedRow, opts: { trigger: RunTrigger; userId?: string | null }): Promise<FeedImportResult> {
  const result = await runParsed(
    feed.workspace_id,
    { source: 'feed', feedId: feed.id, trigger: opts.trigger, userId: opts.userId },
    async () => parseFeed(await downloadFeed(feed.url), { format: feed.format, itemPath: feed.item_path }),
    feed.mapping,
    feedSource(feed.id),
    feed.deactivate_missing,
  )
  await supabaseAdmin().from('portal_feeds').update({ last_run_at: new Date().toISOString() }).eq('id', feed.id)
  return result
}

export function importFile(
  workspaceId: string,
  input: { parsed: ParsedFeed; mapping: unknown; label: string; deactivateMissing: boolean; userId?: string | null },
): Promise<FeedImportResult> {
  return runParsed(
    workspaceId,
    { source: 'file', trigger: 'manual', userId: input.userId },
    async () => input.parsed,
    input.mapping,
    fileSource(input.label),
    input.deactivateMissing,
  )
}

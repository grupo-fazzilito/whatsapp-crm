import 'server-only'
import { productAttributesFor } from '@/lib/catalog/attributes'
import { MAX_IMPORT_ROWS } from '@/lib/catalog/import'
import { finishRun, loadWorkspace, startRun, writeListings, type ImportSummary, type RunTrigger } from '../sync'
import type { PortalListing } from '../values'
import { getMlConfig } from './config'
import { MlApiError, getCategory, getDescription, getItems, listActiveItemIds, type MlCategory } from './client'
import { getMlConnection, markMlConnection, mlAccessToken } from './connection'
import { isRealEstateCategory, mapMlItem, type MlItem } from './mapping'

// Mercado Libre → catalog: the connected account's ACTIVE items in
// real-estate categories (Inmuebles), with description, photos and
// location. Items no longer active are deactivated in our catalog.

export const ML_SOURCE = 'mercadolibre'

export interface MlImportResult {
  runId: string
  summary: ImportSummary | null
  error?: string
  /** Items skipped because they are not real estate. */
  skippedOther?: number
}

export async function importFromMercadoLibre(workspaceId: string, opts: { trigger: RunTrigger; userId?: string | null }): Promise<MlImportResult> {
  const runId = await startRun(workspaceId, 'mercadolibre', { trigger: opts.trigger, userId: opts.userId })
  const conn = await getMlConnection(workspaceId)
  try {
    const ws = await loadWorkspace(workspaceId)
    if (!ws) throw new Error('workspace not found')
    if (!conn) throw new MlApiError(404, 'not_connected', 'Mercado Libre is not connected')
    const cfg = await getMlConfig()
    const token = await mlAccessToken(cfg, conn)

    const ids = await listActiveItemIds(cfg, token, conn.external_user_id, MAX_IMPORT_ROWS)
    const items = await getItems(cfg, token, ids)

    // Keep only Inmuebles (the account may also sell other things).
    const categories = new Map<string, MlCategory | null>()
    for (const id of new Set(items.map((i) => i.category_id).filter((c): c is string => !!c))) {
      categories.set(id, await getCategory(cfg, id).catch(() => null))
    }
    const realEstate: MlItem[] = items.filter((i) => isRealEstateCategory(categories.get(i.category_id ?? '')?.path_from_root))

    const fields = productAttributesFor(ws.industry, ws.settings)
    const listings: PortalListing[] = []
    for (let i = 0; i < realEstate.length; i += 5) {
      const chunk = realEstate.slice(i, i + 5)
      const descriptions = await Promise.all(chunk.map((it) => getDescription(cfg, token, it.id).catch(() => null)))
      chunk.forEach((it, j) => {
        const path = categories.get(it.category_id ?? '')?.path_from_root
        listings.push(mapMlItem(it, descriptions[j], fields, { parentCategoryId: path?.[1]?.id ?? null }))
      })
    }

    // The search only failed if it threw; an account with zero active
    // listings legitimately deactivates everything it imported before —
    // except when nothing at all came back, which writeListings guards.
    const summary = await writeListings({
      workspace: ws,
      externalSource: ML_SOURCE,
      listings,
      deactivateMissing: true,
      userId: opts.userId,
    })
    await finishRun(runId, summary)
    await markMlConnection(conn.id, { last_import_at: new Date().toISOString(), status: 'active', last_error: null })
    return { runId, summary, skippedOther: items.length - realEstate.length }
  } catch (e) {
    const msg = e instanceof MlApiError ? e.code : e instanceof Error ? e.message : String(e)
    await finishRun(runId, null, msg)
    if (conn) await markMlConnection(conn.id, { last_import_at: new Date().toISOString(), last_error: msg, ...(msg === 'reconnect' ? { status: 'error' as const } : {}) })
    return { runId, summary: null, error: msg }
  }
}

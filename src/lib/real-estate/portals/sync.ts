import 'server-only'
import { prisma } from '@/lib/db/prisma'
import { tenantDb } from '@/lib/db/tenant'
import type { Prisma } from '@/generated/prisma/client'
import { invalidateBusinessContext } from '@/lib/ai/context'
import { productAttributesFor } from '@/lib/catalog/attributes'
import { categoryNames, productPayload } from '@/lib/catalog/import'
import { getPlatformSetting } from '@/lib/platform/settings'
import type { Workspace } from '@/lib/workspace/types'
import { copyImages, removeUnusedImages } from './media'
import { missingPatch, planExternalImport, type ExistingExternal, type PlannedListing } from './plan'
import { fieldAccepts, type PortalListing } from './values'

// Writes a batch of listings from one source into the catalog:
// create / update by (external_source, external_id), photos copied to
// our bucket, products gone from the source deactivated (never deleted),
// and a portal_import_runs row with the summary.

export type RunSource = 'mercadolibre' | 'feed' | 'file'
export type RunTrigger = 'manual' | 'schedule'

export interface ImportSummary {
  total: number
  created: number
  updated: number
  deactivated: number
  failed: number
  errors: { ref: string; error: string }[]
  foreignCurrency: number
  imagesCopied: number
  imagesFailed: number
  /** Deactivation skipped because the source looked broken (empty / all invalid). */
  deactivationSkipped?: boolean
}

export class ImportBusyError extends Error {
  constructor() {
    super('An import from this source is already running')
  }
}

const MAX_ERRORS = 50
const RUN_LOCK_MS = 30 * 60 * 1000

/** Non-production switches (local E2E against mock servers). */
export async function portalDevFlags(): Promise<{ allowPrivateHosts: boolean }> {
  if (process.env.NODE_ENV === 'production') return { allowPrivateHosts: false }
  const s = await getPlatformSetting<{ dev_allow_private_hosts?: boolean }>('portals')
  return { allowPrivateHosts: !!s?.dev_allow_private_hosts || process.env.PORTALS_ALLOW_PRIVATE_HOSTS === '1' }
}

export async function loadWorkspace(workspaceId: string): Promise<Workspace | null> {
  const data = await tenantDb(workspaceId).workspaces.findFirst({ where: { id: workspaceId } }).catch(() => null)
  return (data as Workspace | null) ?? null
}

export async function startRun(workspaceId: string, source: RunSource, opts: { feedId?: string | null; trigger: RunTrigger; userId?: string | null }): Promise<string> {
  const db = tenantDb(workspaceId)
  const running = await db.portal_import_runs
    .findFirst({
      select: { id: true },
      where: {
        source,
        status: 'running',
        started_at: { gte: new Date(Date.now() - RUN_LOCK_MS).toISOString() },
        ...(opts.feedId ? { feed_id: opts.feedId } : {}),
      },
    })
    .catch(() => null)
  if (running) throw new ImportBusyError()
  try {
    const data = await db.portal_import_runs.create({
      data: { workspace_id: workspaceId, source, feed_id: opts.feedId ?? null, trigger: opts.trigger, started_by: opts.userId ?? null },
      select: { id: true },
    })
    return data.id
  } catch (e) {
    throw new Error(e instanceof Error ? e.message : String(e))
  }
}

export async function finishRun(runId: string, summary: ImportSummary | null, error?: string | null): Promise<void> {
  const status = error ? 'error' : summary && summary.failed > 0 ? 'partial' : 'success'
  // By primary key only (callers pass just the run id), as before.
  await prisma.portal_import_runs
    .updateMany({
      where: { id: runId },
      data: {
      status,
      error: error ? error.slice(0, 500) : null,
      ...(summary
        ? {
            total: summary.total,
            created: summary.created,
            updated: summary.updated,
            deactivated: summary.deactivated,
            failed: summary.failed,
            errors: summary.errors.slice(0, MAX_ERRORS),
            notes: {
              foreign_currency: summary.foreignCurrency,
              images_copied: summary.imagesCopied,
              images_failed: summary.imagesFailed,
              deactivation_skipped: !!summary.deactivationSkipped,
            },
          }
        : {}),
      finished_at: new Date().toISOString(),
      },
    })
    .catch(() => undefined)
}

async function existingFor(workspaceId: string, externalSource: string): Promise<ExistingExternal[]> {
  const out: ExistingExternal[] = []
  for (let from = 0; ; from += 1000) {
    let data
    try {
      data = await tenantDb(workspaceId).products.findMany({
        select: { id: true, external_id: true, attributes: true, images: true, is_active: true, external_missing_since: true },
        where: { external_source: externalSource },
        orderBy: { id: 'asc' },
        skip: from,
        take: 1000,
      })
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : String(e))
    }
    for (const p of data) {
      out.push({
        id: p.id,
        externalId: String(p.external_id),
        attributes: (p.attributes as Record<string, unknown>) ?? {},
        images: (p.images as string[]) ?? [],
        isActive: !!p.is_active,
        missingSince: (p.external_missing_since as string | null) ?? null,
      })
    }
    if (!data || data.length < 1000) break
  }
  return out
}

async function ensureCategories(workspaceId: string, names: string[]): Promise<Map<string, string>> {
  const db = tenantDb(workspaceId)
  const map = new Map<string, string>()
  const load = async () => {
    let data
    try {
      data = await db.product_categories.findMany({ select: { id: true, name: true } })
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : String(e))
    }
    for (const c of data) map.set(String(c.name).trim().toLowerCase(), c.id)
  }
  await load()
  const missing = names.filter((n) => !map.has(n.toLowerCase()))
  if (missing.length) {
    try {
      await db.product_categories.createMany({ data: missing.map((name) => ({ workspace_id: workspaceId, name })), skipDuplicates: true })
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : String(e))
    }
    await load()
  }
  return map
}

async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  let i = 0
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (i < items.length) await fn(items[i++])
    }),
  )
}

export interface WriteOptions {
  workspace: Workspace
  /** products.external_source value, e.g. 'mercadolibre' or 'feed:<id>'. */
  externalSource: string
  listings: PortalListing[]
  deactivateMissing: boolean
  copyPhotos?: boolean
  userId?: string | null
}

export async function writeListings(opts: WriteOptions): Promise<ImportSummary> {
  const { workspace: ws, externalSource } = opts
  const db = tenantDb(ws.id)
  const fields = productAttributesFor(ws.industry, ws.settings)
  const existing = await existingFor(ws.id, externalSource)
  const plan = planExternalImport(opts.listings, existing, {
    fields,
    workspaceCurrency: ws.currency || 'PEN',
    deactivateMissing: opts.deactivateMissing,
  })
  const { allowPrivateHosts } = await portalDevFlags()

  const summary: ImportSummary = {
    total: opts.listings.length,
    created: 0,
    updated: 0,
    deactivated: 0,
    failed: plan.errors,
    errors: [],
    foreignCurrency: plan.foreignCurrency,
    imagesCopied: 0,
    imagesFailed: 0,
  }
  const fail = (r: PlannedListing, error: string) => {
    if (summary.errors.length < MAX_ERRORS) summary.errors.push({ ref: r.externalId || `#${r.row}`, error })
  }
  for (const r of plan.rows) if (r.action === 'error') fail(r, r.errors.map((e) => `${e.field}: ${e.code}`).join('; '))

  const todo = plan.rows.filter((r) => r.action !== 'error')
  const categories = await ensureCategories(ws.id, categoryNames(todo.map((r) => r.data)))
  const now = new Date().toISOString()

  await pool(todo, 4, async (r) => {
    try {
      const before = r.current?.images ?? []
      if (r.data.images && opts.copyPhotos !== false) {
        const res = await copyImages(ws.id, externalSource, r.data.images, before, { allowPrivate: allowPrivateHosts })
        summary.imagesCopied += res.copied
        summary.imagesFailed += res.failed
        r.data.images = res.urls
      }
      const categoryId = r.data.category ? categories.get(r.data.category.trim().toLowerCase()) ?? null : undefined
      const payload: Record<string, unknown> = {
        ...productPayload(r.data, categoryId, r.action === 'update' ? 'update' : 'create', r.current?.attributes),
        external_source: externalSource,
        external_id: r.externalId,
        external_url: r.externalUrl,
        external_synced_at: now,
      }
      if (r.action === 'update' && r.current) {
        if (r.current.missingSince) {
          // Back in the source: visible again unless the source says otherwise.
          payload.external_missing_since = null
          if (r.data.is_active === undefined) payload.is_active = true
          const attrs = (payload.attributes ?? r.current.attributes ?? {}) as Record<string, unknown>
          if (attrs.listing_status === 'inactive' && fieldAccepts(fields, 'listing_status', 'available')) {
            payload.attributes = { ...attrs, listing_status: 'available' }
          }
        }
        await db.products.updateMany({ where: { id: r.productId! }, data: payload as Prisma.productsUncheckedUpdateManyInput })
        summary.updated++
        if (r.data.images) await removeUnusedImages(ws.id, before, r.data.images).catch(() => {})
      } else {
        await db.products.create({
          data: { ...payload, workspace_id: ws.id, created_by: opts.userId ?? null } as Prisma.productsUncheckedCreateInput,
          select: { id: true },
        })
        summary.created++
      }
    } catch (e) {
      summary.failed++
      fail(r, e instanceof Error ? e.message : String(e))
    }
  })

  // Disappeared from the source → deactivate. Skipped when the source
  // looks broken (nothing valid came in) so a bad export can't hide the
  // whole catalog.
  if (plan.missing.length) {
    if (todo.length === 0) summary.deactivationSkipped = true
    else {
      await pool(plan.missing, 4, async (m) => {
        const ok = await db.products
          .updateMany({ where: { id: m.id }, data: missingPatch(fields, m.attributes, now) as Prisma.productsUncheckedUpdateManyInput })
          .then(() => true)
          .catch(() => false)
        if (ok) summary.deactivated++
      })
    }
  }

  if (summary.created + summary.updated + summary.deactivated > 0) invalidateBusinessContext(ws.id)
  return summary
}

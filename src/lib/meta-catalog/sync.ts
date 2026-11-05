import 'server-only'
import { after } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { tenantDb } from '@/lib/db/tenant'
import { loadChannel } from '@/lib/channels/store'
import { siteUrl } from '@/lib/real-estate/listing/url'
import { storePath } from '@/lib/store/settings'
import { catalogAuth, CatalogGraphError, itemsBatch } from './graph'
import { catalogItems, type CatalogContext, type CatalogItem } from './items'

// Real-time sync of Whasalia's products to the business's Meta catalog.
// DB triggers queue every product change (meta_catalog_queue, migration 28);
// syncWorkspaceCatalog() drains the queue right after a change and the cron
// retries whatever is left (Meta down, rate limit…).

const BATCH = 1000
const MAX_ATTEMPTS = 20
const MAX_ITEM_ERRORS = 50

export interface SyncResult {
  sent: number
  deleted: number
  errors: number
  skipped?: 'not_connected' | 'busy' | 'empty'
  error?: string
}

const running = new Set<string>()

function contextFor(ws: { name: string; slug: string; currency: string }): CatalogContext {
  const site = siteUrl()
  return {
    currency: ws.currency,
    brand: ws.name,
    productUrl: (id) => `${site}${storePath(ws.slug)}/producto/${id}`,
    imageUrl: (u) => (/^https:\/\//.test(u) ? u : u.startsWith('/') ? `${site}${u}` : /^http:\/\//.test(u) ? u : null),
  }
}

async function plansFor(workspaceId: string, productIds: string[], ctx: CatalogContext) {
  const db = tenantDb(workspaceId)
  const rows = productIds.length
    ? await db.products.findMany({
        where: { id: { in: productIds } },
        select: {
          id: true,
          name: true,
          description: true,
          price: true,
          compare_at_price: true,
          currency: true,
          track_stock: true,
          stock: true,
          images: true,
          is_active: true,
          product_variants: { select: { id: true, name: true, options: true, price: true, stock: true, is_active: true }, orderBy: { sort_order: 'asc' } },
        },
      })
    : []
  const upserts: CatalogItem[] = []
  const deletes: string[] = []
  const found = new Set(rows.map((r) => r.id))
  for (const p of rows) {
    const plan = catalogItems(
      {
        ...p,
        price: p.price === null ? null : Number(p.price),
        compare_at_price: p.compare_at_price === null ? null : Number(p.compare_at_price),
        variants: p.product_variants.map((v) => ({ ...v, options: (v.options ?? {}) as Record<string, string>, price: v.price === null ? null : Number(v.price) })),
      },
      ctx,
    )
    upserts.push(...plan.upserts)
    deletes.push(...plan.deletes)
  }
  // Deleted products: their item (variants come as their own delete rows).
  for (const id of productIds) if (!found.has(id)) deletes.push(id)
  return { upserts, deletes }
}

/** Sends the queued changes of one workspace. Never throws. */
export async function syncWorkspaceCatalog(workspaceId: string): Promise<SyncResult> {
  if (running.has(workspaceId)) return { sent: 0, deleted: 0, errors: 0, skipped: 'busy' }
  running.add(workspaceId)
  try {
    return await drain(workspaceId)
  } catch (err) {
    console.error('[meta-catalog] sync failed:', err instanceof Error ? err.message : err)
    return { sent: 0, deleted: 0, errors: 0, error: err instanceof Error ? err.message : String(err) }
  } finally {
    running.delete(workspaceId)
  }
}

async function drain(workspaceId: string): Promise<SyncResult> {
  const db = tenantDb(workspaceId)
  const conn = await db.meta_catalogs.findFirst({ where: { workspace_id: workspaceId } })
  if (!conn) return { sent: 0, deleted: 0, errors: 0, skipped: 'not_connected' }
  const out: SyncResult = { sent: 0, deleted: 0, errors: 0 }
  const ws = await prisma.workspaces.findUnique({ where: { id: workspaceId }, select: { name: true, slug: true, currency: true } })
  const channel = await loadChannel(workspaceId, conn.channel_id)
  if (!ws || !channel) return { ...out, error: 'channel_missing' }
  const ctx = contextFor(ws)
  const itemErrors: { retailer_id: string; message: string }[] = []

  for (let round = 0; round < 20; round++) {
    const rows = await db.meta_catalog_queue.findMany({ where: { attempts: { lt: MAX_ATTEMPTS } }, orderBy: { created_at: 'asc' }, take: BATCH })
    if (!rows.length) break
    const productIds = [...new Set(rows.filter((r) => r.op === 'upsert' && r.product_id).map((r) => r.product_id!))]
    const plan = await plansFor(workspaceId, productIds, ctx)
    const deletes = [...new Set([...plan.deletes, ...rows.filter((r) => r.op === 'delete' && r.retailer_id).map((r) => r.retailer_id!)])]
    const ids = rows.map((r) => r.id)
    try {
      const auth = catalogAuth(channel)
      const r = plan.upserts.length || deletes.length ? await itemsBatch(auth, conn.catalog_id, plan.upserts, deletes) : { handles: [], errors: [] }
      await db.meta_catalog_queue.deleteMany({ where: { id: { in: ids } } })
      out.sent += plan.upserts.length - r.errors.length
      out.deleted += deletes.length
      out.errors += r.errors.length
      itemErrors.push(...r.errors)
    } catch (err) {
      const message = err instanceof CatalogGraphError && err.permission ? 'permission' : err instanceof Error ? err.message.slice(0, 300) : String(err)
      await db.meta_catalog_queue.updateMany({ where: { id: { in: ids } }, data: { attempts: { increment: 1 } } })
      await db.meta_catalogs.updateMany({ where: { workspace_id: workspaceId }, data: { status: 'error', last_error: message, updated_at: new Date() } })
      return { ...out, error: message }
    }
    if (rows.length < BATCH) break
  }
  await db.meta_catalogs.updateMany({
    where: { workspace_id: workspaceId },
    data: {
      status: 'active',
      last_error: null,
      last_synced_at: new Date(),
      updated_at: new Date(),
      ...(out.sent || out.errors ? { item_errors: itemErrors.slice(0, MAX_ITEM_ERRORS) } : {}),
    },
  })
  return out
}

/** Queues every product of the workspace (first connection, "Sync now"). */
export async function queueAllProducts(workspaceId: string): Promise<number> {
  const db = tenantDb(workspaceId)
  const ids = (await db.products.findMany({ select: { id: true } })).map((p) => p.id)
  if (!ids.length) return 0
  await db.meta_catalog_queue.deleteMany({ where: { op: 'upsert', product_id: { in: ids } } })
  await db.meta_catalog_queue.createMany({ data: ids.map((product_id) => ({ workspace_id: workspaceId, product_id, op: 'upsert' })) })
  return ids.length
}

/** Cron: every workspace with queued changes. */
export async function syncAllCatalogs(): Promise<{ workspaces: number; sent: number; errors: number }> {
  const pending = await prisma.meta_catalog_queue
    .findMany({ where: { attempts: { lt: MAX_ATTEMPTS } }, select: { workspace_id: true }, distinct: ['workspace_id'], take: 50 })
    .catch(() => [])
  const total = { workspaces: 0, sent: 0, errors: 0 }
  for (const { workspace_id } of pending) {
    const r = await syncWorkspaceCatalog(workspace_id)
    total.workspaces++
    total.sent += r.sent
    total.errors += r.errors
  }
  return total
}

/**
 * After the response: sends this workspace's queued product changes to Meta
 * (a no-op without a connected catalog). Call it wherever products or stock change.
 */
export function kickCatalogSync(workspaceId: string): void {
  try {
    after(() => syncWorkspaceCatalog(workspaceId).then(() => undefined))
  } catch {
    // Outside a request (scripts, cron): run it now, without waiting.
    void syncWorkspaceCatalog(workspaceId)
  }
}

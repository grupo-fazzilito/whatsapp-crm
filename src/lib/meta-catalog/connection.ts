import 'server-only'
import { tenantDb } from '@/lib/db/tenant'
import { loadChannel } from '@/lib/channels/store'
import { catalogAuth, CatalogGraphError, createCatalog, linkCatalog, linkedCatalog, setCommerce } from './graph'
import { catalogBlocker } from './items'
import { queueAllProducts, syncWorkspaceCatalog } from './sync'
import { siteUrl } from '@/lib/real-estate/listing/url'

/** Meta's answer → a code the UI explains ("permission" = reconnect with catalog permission). */
export function graphErrorCode(err: unknown): string {
  if (err instanceof CatalogGraphError) return err.permission ? 'permission' : err.message
  return err instanceof Error ? err.message : String(err)
}

export interface CatalogStatus {
  connection: {
    catalog_id: string
    catalog_name: string | null
    status: string
    last_synced_at: string | null
    last_error: string | null
    item_errors: { retailer_id: string; message: string }[]
    channel: { id: string; name: string; handle: string | null } | null
  } | null
  channels: { id: string; name: string; handle: string | null }[]
  pending: number
  /** Products that can't go to Meta, by reason. */
  blocked: Record<'inactive' | 'currency' | 'image' | 'price', number>
  total: number
}

export async function catalogStatus(ws: { id: string; currency: string }): Promise<CatalogStatus> {
  const db = tenantDb(ws.id)
  const [conn, channels, pending, products] = await Promise.all([
    db.meta_catalogs.findFirst({ where: { workspace_id: ws.id } }),
    db.channels.findMany({ where: { type: 'whatsapp', status: 'connected' }, select: { id: true, name: true, display_handle: true }, orderBy: { created_at: 'asc' } }),
    db.meta_catalog_queue.count(),
    db.products.findMany({ select: { id: true, is_active: true, currency: true, images: true, price: true, product_variants: { select: { price: true, is_active: true } } }, take: 5000 }),
  ])
  const site = siteUrl()
  const blocked = { inactive: 0, currency: 0, image: 0, price: 0 }
  for (const p of products) {
    const why = catalogBlocker(
      {
        id: p.id,
        name: '',
        description: null,
        price: p.price === null ? null : Number(p.price),
        compare_at_price: null,
        currency: p.currency,
        track_stock: false,
        stock: null,
        images: p.images,
        is_active: p.is_active,
        variants: p.product_variants.map((v) => ({ id: '', name: '', options: {}, stock: null, is_active: v.is_active, price: v.price === null ? null : Number(v.price) })),
      },
      { currency: ws.currency, brand: '', productUrl: () => site, imageUrl: (u) => (/^https?:\/\//.test(u) || u.startsWith('/') ? u : null) },
    )
    if (why) blocked[why]++
  }
  const list = channels.map((c) => ({ id: c.id, name: c.name, handle: c.display_handle }))
  return {
    connection: conn
      ? {
          catalog_id: conn.catalog_id,
          catalog_name: conn.catalog_name,
          status: conn.status,
          last_synced_at: conn.last_synced_at ? new Date(conn.last_synced_at).toISOString() : null,
          last_error: conn.last_error,
          item_errors: Array.isArray(conn.item_errors) ? (conn.item_errors as { retailer_id: string; message: string }[]) : [],
          channel: list.find((c) => c.id === conn.channel_id) ?? null,
        }
      : null,
    channels: list,
    pending,
    blocked,
    total: products.length,
  }
}

export type ConnectResult = { ok: true } | { ok: false; error: string; status: number }

/**
 * Connects a catalog to the business's WhatsApp number: an existing one
 * (catalogId) or a new one (createName), turns on the storefront and the
 * cart in the chat, and sends every product.
 */
export async function connectCatalog(wsId: string, userId: string, input: { channelId: string; catalogId?: string | null; createName?: string | null }): Promise<ConnectResult> {
  const channel = await loadChannel(wsId, input.channelId)
  if (!channel || channel.type !== 'whatsapp') return { ok: false, error: 'channel', status: 400 }
  let catalog: { id: string; name: string | null }
  try {
    const auth = catalogAuth(channel)
    const linked = await linkedCatalog(auth)
    if (input.createName) {
      if (linked) return { ok: false, error: 'already_linked', status: 409 }
      catalog = await createCatalog(auth, input.createName)
      await linkCatalog(auth, catalog.id)
    } else if (input.catalogId) {
      if (linked && linked.id !== input.catalogId) return { ok: false, error: 'already_linked', status: 409 }
      if (!linked) await linkCatalog(auth, input.catalogId)
      catalog = { id: input.catalogId, name: linked?.name ?? null }
    } else {
      return { ok: false, error: 'catalog', status: 400 }
    }
    await setCommerce(auth, true)
  } catch (err) {
    return { ok: false, error: graphErrorCode(err), status: 502 }
  }
  const db = tenantDb(wsId)
  const row = { channel_id: channel.id, catalog_id: catalog.id, catalog_name: catalog.name, status: 'active', last_error: null, item_errors: [], connected_by: userId, updated_at: new Date() }
  const updated = await db.meta_catalogs.updateMany({ where: { workspace_id: wsId }, data: row })
  if (!updated.count) await db.meta_catalogs.create({ data: { ...row, workspace_id: wsId } })
  await queueAllProducts(wsId)
  await syncWorkspaceCatalog(wsId)
  return { ok: true }
}

/** Stops syncing and hides the storefront and cart (the catalog stays in Meta). */
export async function disconnectCatalog(wsId: string): Promise<void> {
  const db = tenantDb(wsId)
  const conn = await db.meta_catalogs.findFirst({ where: { workspace_id: wsId } })
  if (!conn) return
  const channel = await loadChannel(wsId, conn.channel_id)
  if (channel) await setCommerce(catalogAuth(channel), false).catch((err) => console.warn('[meta-catalog] commerce off failed:', graphErrorCode(err)))
  await db.meta_catalogs.deleteMany({ where: { workspace_id: wsId } })
  await db.meta_catalog_queue.deleteMany({})
}

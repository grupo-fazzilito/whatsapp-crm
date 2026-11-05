import 'server-only'
import { getMetaConfig } from '@/lib/platform/meta'
import type { LoadedChannel } from '@/lib/channels/types'
import type { CatalogItem } from './items'

// Meta Graph calls for the WhatsApp catalog, with the WhatsApp number's
// token (it needs the catalog_management permission).
//   catalogs:  GET  /{business}/owned_product_catalogs, POST to create one
//   link:      POST /{waba}/product_catalogs { catalog_id } (one per WABA)
//   commerce:  POST /{phone_number_id}/whatsapp_commerce_settings
//   items:     POST /{catalog}/items_batch (up to 5000 per call)

export class CatalogGraphError extends Error {
  constructor(
    message: string,
    readonly code: number | null = null,
  ) {
    super(message)
  }
  /** The token lacks catalog_management (or the asset isn't shared with it). */
  get permission() {
    return this.code === 10 || this.code === 190 || (this.code !== null && this.code >= 200 && this.code < 300) || /permission/i.test(this.message)
  }
}

async function graph<T = Record<string, unknown>>(path: string, token: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const { graphBase } = await getMetaConfig()
  const res = await fetch(`${graphBase}${path}`, {
    method: init.method ?? 'GET',
    cache: 'no-store',
    headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(60_000),
  })
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: { message?: string; error_user_msg?: string; code?: number } }
  if (!res.ok || body.error) {
    const e = body.error
    throw new CatalogGraphError(e?.error_user_msg || e?.message || `Meta API error ${res.status}`, e?.code ?? null)
  }
  return body as T
}

export interface CatalogAuth {
  token: string
  wabaId: string
  phoneNumberId: string
  businessId: string | null
}

export function catalogAuth(channel: LoadedChannel): CatalogAuth {
  const token = channel.secrets.access_token
  const wabaId = typeof channel.settings?.waba_id === 'string' ? channel.settings.waba_id : ''
  if (channel.type !== 'whatsapp' || !token || !wabaId) throw new CatalogGraphError('whatsapp_not_connected')
  const businessId = typeof channel.settings?.business_id === 'string' && channel.settings.business_id ? channel.settings.business_id : null
  return { token, wabaId, phoneNumberId: channel.external_id, businessId }
}

export interface MetaCatalog {
  id: string
  name: string
  product_count?: number
}

/** The business that owns the WhatsApp account (stored at signup, else asked). */
export async function businessOf(auth: CatalogAuth): Promise<string> {
  if (auth.businessId) return auth.businessId
  const r = await graph<{ owner_business_info?: { id?: string } }>(`/${encodeURIComponent(auth.wabaId)}?fields=owner_business_info`, auth.token)
  const id = r.owner_business_info?.id
  if (!id) throw new CatalogGraphError('business_missing')
  return id
}

/** Catalog already connected to the WhatsApp account, if any. */
export async function linkedCatalog(auth: CatalogAuth): Promise<MetaCatalog | null> {
  const r = await graph<{ data?: MetaCatalog[] }>(`/${encodeURIComponent(auth.wabaId)}/product_catalogs?fields=id,name`, auth.token)
  return r.data?.[0] ?? null
}

export async function listCatalogs(auth: CatalogAuth): Promise<MetaCatalog[]> {
  const business = await businessOf(auth)
  const r = await graph<{ data?: MetaCatalog[] }>(`/${encodeURIComponent(business)}/owned_product_catalogs?fields=id,name,product_count&limit=50`, auth.token)
  return r.data ?? []
}

export async function createCatalog(auth: CatalogAuth, name: string): Promise<MetaCatalog> {
  const business = await businessOf(auth)
  const r = await graph<{ id?: string }>(`/${encodeURIComponent(business)}/owned_product_catalogs`, auth.token, { method: 'POST', body: { name } })
  if (!r.id) throw new CatalogGraphError('catalog_not_created')
  return { id: r.id, name }
}

export async function linkCatalog(auth: CatalogAuth, catalogId: string): Promise<void> {
  await graph(`/${encodeURIComponent(auth.wabaId)}/product_catalogs`, auth.token, { method: 'POST', body: { catalog_id: catalogId } })
}

/** Storefront icon + cart in the chat (or both off). */
export async function setCommerce(auth: CatalogAuth, on: boolean): Promise<void> {
  const qs = new URLSearchParams({ is_catalog_visible: String(on), is_cart_enabled: String(on) })
  await graph(`/${encodeURIComponent(auth.phoneNumberId)}/whatsapp_commerce_settings?${qs}`, auth.token, { method: 'POST' })
}

export interface BatchResult {
  handles: string[]
  errors: { retailer_id: string; message: string }[]
}

/** Upserts and deletes in one call (≤ 5000 requests). */
export async function itemsBatch(auth: CatalogAuth, catalogId: string, upserts: CatalogItem[], deletes: string[]): Promise<BatchResult> {
  const requests = [
    ...upserts.map((data) => ({ method: 'UPDATE', data })),
    ...deletes.map((id) => ({ method: 'DELETE', data: { id } })),
  ]
  const r = await graph<{ handles?: string[]; validation_status?: { retailer_id?: string; errors?: { message?: string }[] }[] }>(
    `/${encodeURIComponent(catalogId)}/items_batch`,
    auth.token,
    { method: 'POST', body: { item_type: 'PRODUCT_ITEM', allow_upsert: true, requests } },
  )
  const deleted = new Set(deletes)
  const errors = (r.validation_status ?? [])
    // Deleting an item that was never there isn't a problem.
    .filter((v) => v.retailer_id && !deleted.has(v.retailer_id) && v.errors?.length)
    .map((v) => ({ retailer_id: v.retailer_id!, message: v.errors!.map((e) => e.message).filter(Boolean).join('; ').slice(0, 300) }))
  return { handles: r.handles ?? [], errors }
}

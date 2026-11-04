import 'server-only'
import crypto from 'node:crypto'
import { cache } from 'react'
import { prisma } from '@/lib/db/prisma'
import { tenantDb } from '@/lib/db/tenant'
import { getSessionUser } from '@/lib/auth/session'
import { isUuid } from '@/lib/workspace/constants'
import { countryDefaults, formatMoney, moneyLocale } from '@/lib/workspace/countries'
import { resolveIndustry } from '@/lib/industries'
import { cartCurrencyConflict } from '@/lib/catalog/currency'
import { phonesMatch } from '@/lib/whatsapp/phone-utils'
import { emailConfigured, sendEmail } from '@/lib/email/send'
import type { WorkspaceSettings } from '@/lib/workspace/types'
import { orderFees, storeSettings, type StoreReadiness, type StoreSettings } from './settings'
import { orderWeight, quoteShipping, toShippingProfile, type ShippingProfile } from './shipping'
import { addressLine, type CheckoutInput, type CheckoutItem } from './checkout'

const round2 = (n: number) => Math.round(n * 100) / 100

// ------------------------------------------------------------
// The store
// ------------------------------------------------------------
export interface StoreWorkspace {
  id: string
  name: string
  slug: string
  industry: string
  country: string | null
  currency: string
  locale: 'es' | 'en'
  description: string | null
  phone: string | null
  logo_url: string | null
  settings: WorkspaceSettings
}

export interface PublicStore {
  workspace: StoreWorkspace
  store: StoreSettings
  /** Opened by a member before it is published. */
  preview: boolean
  /** Digits for wa.me (store setting, else the workspace phone). */
  whatsapp: string | null
  dialCode: string
}

const WS_SELECT = { id: true, name: true, slug: true, industry: true, country: true, currency: true, locale: true, description: true, phone: true, logo_url: true, settings: true } as const

/**
 * Store of a slug, or null when unknown or not published. Members of the
 * business see it unpublished too (preview). Cached per request.
 */
export const loadStore = cache(async (slug: string): Promise<PublicStore | null> => {
  if (!slug || slug.length > 120) return null
  // Public page: the workspace is only known by its slug (platform lookup).
  const ws = await prisma.workspaces.findFirst({ select: WS_SELECT, where: { slug } }).catch(() => null)
  if (!ws) return null
  const store = storeSettings((ws.settings as WorkspaceSettings | null)?.store)
  let preview = false
  if (!store.enabled) {
    const user = await getSessionUser().catch(() => null)
    const member = user
      ? await prisma.workspace_members.findFirst({ where: { workspace_id: ws.id, user_id: user.id, status: 'active' }, select: { user_id: true } }).catch(() => null)
      : null
    if (!member) return null
    preview = true
  }
  const dial = countryDefaults(ws.country).dialCode
  const phoneDigits = (ws.phone ?? '').replace(/\D/g, '')
  const whatsapp = store.whatsapp ?? (phoneDigits.length >= 8 ? (phoneDigits.length <= 9 ? dial.replace(/\D/g, '') + phoneDigits : phoneDigits) : null)
  return {
    workspace: { ...ws, locale: ws.locale === 'en' ? 'en' : 'es', settings: (ws.settings ?? {}) as WorkspaceSettings },
    store,
    preview,
    whatsapp,
    dialCode: dial,
  }
})

export function storeMoney(ws: Pick<StoreWorkspace, 'currency' | 'locale' | 'country'>) {
  return (n: number) => formatMoney(n, ws.currency, moneyLocale(ws))
}

// ------------------------------------------------------------
// Catalog
// ------------------------------------------------------------
export interface StoreVariant {
  id: string
  name: string
  price: number
  available: number | null
}

export interface StoreProduct {
  id: string
  name: string
  description: string | null
  price: number
  compare_at_price: number | null
  images: string[]
  category_id: string | null
  is_featured: boolean
  /** Null = not tracked (always available). */
  available: number | null
  variants: StoreVariant[]
}

export interface StoreCategory {
  id: string
  name: string
}

const publicImages = (list: unknown) => (Array.isArray(list) ? list.filter((u): u is string => typeof u === 'string' && /^https?:\/\//.test(u)) : [])

/** Active, priced products in the workspace currency, with their active variants. */
export async function loadStoreCatalog(ws: StoreWorkspace, productId?: string): Promise<{ products: StoreProduct[]; categories: StoreCategory[] }> {
  const db = tenantDb(ws.id)
  const [rows, cats] = await Promise.all([
    db.products.findMany({
      where: { is_active: true, ...(productId ? { id: productId } : {}) },
      select: {
        id: true,
        name: true,
        description: true,
        price: true,
        compare_at_price: true,
        currency: true,
        images: true,
        category_id: true,
        is_featured: true,
        track_stock: true,
        stock: true,
        product_variants: { where: { is_active: true }, select: { id: true, name: true, price: true, stock: true }, orderBy: { sort_order: 'asc' } },
      },
      orderBy: [{ is_featured: 'desc' }, { sort_order: 'asc' }, { created_at: 'desc' }],
      take: 500,
    }),
    productId ? Promise.resolve([]) : db.product_categories.findMany({ select: { id: true, name: true }, orderBy: [{ sort_order: 'asc' }, { name: 'asc' }] }),
  ])
  const products: StoreProduct[] = []
  for (const p of rows) {
    if (cartCurrencyConflict(p, ws.currency)) continue
    const variants = p.product_variants
      .map((v) => ({ id: v.id, name: v.name, price: Number(v.price ?? p.price ?? NaN), available: p.track_stock ? Math.max(0, v.stock ?? p.stock ?? 0) : null }))
      .filter((v) => Number.isFinite(v.price))
    const price = p.price === null ? (variants.length ? Math.min(...variants.map((v) => v.price)) : null) : Number(p.price)
    if (price === null || !Number.isFinite(price)) continue
    products.push({
      id: p.id,
      name: p.name,
      description: p.description,
      price,
      compare_at_price: p.compare_at_price === null ? null : Number(p.compare_at_price),
      images: publicImages(p.images),
      category_id: p.category_id,
      is_featured: p.is_featured,
      available: p.track_stock ? Math.max(0, p.stock ?? 0) : null,
      variants,
    })
  }
  const used = new Set(products.map((p) => p.category_id))
  return { products, categories: (cats as StoreCategory[]).filter((c) => used.has(c.id)) }
}

// ------------------------------------------------------------
// Checkout options
// ------------------------------------------------------------
export interface StorePaymentMethod {
  id: string
  name: string
  type: string
  instructions: string | null
  qr_image_url: string | null
  requires_proof: boolean
}

export async function loadCheckoutOptions(wsId: string): Promise<{ shipping: ShippingProfile[]; payments: StorePaymentMethod[] }> {
  const db = tenantDb(wsId)
  const [ship, pay] = await Promise.all([
    db.shipping_profiles.findMany({ where: { is_active: true }, orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }] }),
    db.payment_methods.findMany({
      where: { is_active: true },
      select: { id: true, name: true, type: true, instructions: true, qr_image_url: true, requires_proof: true },
      orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
    }),
  ])
  return { shipping: ship.map(toShippingProfile), payments: pay }
}

/** What the store still needs before it can be published. */
export async function storeReadiness(ws: { id: string; industry: string; settings: WorkspaceSettings }): Promise<StoreReadiness> {
  const db = tenantDb(ws.id)
  const store = storeSettings(ws.settings?.store)
  const modules = resolveIndustry(ws.industry, ws.settings).modules
  const [profiles, payments, products, services] = await Promise.all([
    db.shipping_profiles.count({ where: { is_active: true } }),
    db.payment_methods.count({ where: { is_active: true } }),
    modules.products ? db.products.count({ where: { is_active: true } }) : Promise.resolve(0),
    modules.services ? db.services.count({ where: { is_active: true, show_in_store: true } }) : Promise.resolve(0),
  ])
  return {
    ordersModule: modules.orders,
    // Shipping only matters when there are physical products to send.
    shipping: products === 0 || profiles > 0 || store.pickup_enabled,
    payment: payments > 0,
    products: products > 0 || services > 0,
  }
}

// ------------------------------------------------------------
// Pricing (the server's numbers are the ones that count)
// ------------------------------------------------------------
export interface PricedLine {
  productId: string
  variantId: string | null
  name: string
  variantName: string | null
  sku: string | null
  quantity: number
  unitPrice: number
  weightKg: number | null
}

export type PriceResult = { ok: true; lines: PricedLine[]; subtotal: number; weightKg: number } | { ok: false; error: 'unavailable' | 'stock'; name?: string; available?: number }

export async function priceItems(ws: StoreWorkspace, items: CheckoutItem[]): Promise<PriceResult> {
  const db = tenantDb(ws.id)
  const ids = [...new Set(items.map((i) => i.product_id))]
  const rows = await db.products.findMany({
    where: { id: { in: ids }, is_active: true },
    select: {
      id: true,
      name: true,
      sku: true,
      price: true,
      currency: true,
      track_stock: true,
      stock: true,
      weight_kg: true,
      product_variants: { where: { is_active: true }, select: { id: true, name: true, sku: true, price: true, stock: true, weight_kg: true } },
    },
  })
  const byId = new Map(rows.map((r) => [r.id, r]))
  const lines: PricedLine[] = []
  for (const it of items) {
    const p = byId.get(it.product_id)
    if (!p || cartCurrencyConflict(p, ws.currency)) return { ok: false, error: 'unavailable' }
    const v = it.variant_id ? p.product_variants.find((x) => x.id === it.variant_id) : null
    if (it.variant_id && !v) return { ok: false, error: 'unavailable', name: p.name }
    // A product with variants is bought as one of them.
    if (!it.variant_id && p.product_variants.length > 0) return { ok: false, error: 'unavailable', name: p.name }
    const price = v?.price ?? p.price
    if (price === null || price === undefined) return { ok: false, error: 'unavailable', name: p.name }
    if (p.track_stock) {
      const available = v && v.stock !== null ? v.stock : p.stock ?? 0
      if (available < it.quantity) return { ok: false, error: 'stock', name: v ? `${p.name} (${v.name})` : p.name, available: Math.max(0, available) }
    }
    const weight = v?.weight_kg ?? p.weight_kg
    lines.push({
      productId: p.id,
      variantId: v?.id ?? null,
      name: p.name,
      variantName: v?.name ?? null,
      sku: v?.sku ?? p.sku ?? null,
      quantity: it.quantity,
      unitPrice: Number(price),
      weightKg: weight === null || weight === undefined ? null : Number(weight),
    })
  }
  const subtotal = round2(lines.reduce((a, l) => a + l.unitPrice * l.quantity, 0))
  return { ok: true, lines, subtotal, weightKg: orderWeight(lines) }
}

// ------------------------------------------------------------
// Placing the order
// ------------------------------------------------------------
export type PlaceStoreResult =
  | { ok: true; number: number; token: string; total: number }
  | { ok: false; error: 'unavailable' | 'stock' | 'shipping' | 'too_heavy' | 'payment' | 'pickup' | 'min_order'; name?: string; available?: number }

/** Contact with this phone (any formatting), or a new one. */
export async function contactFor(wsId: string, name: string, phone: string, email: string | null): Promise<string> {
  const db = tenantDb(wsId)
  const tail = phone.slice(-4)
  const candidates = await db.contacts.findMany({ where: { phone: { endsWith: tail } }, select: { id: true, phone: true, email: true }, take: 50 })
  const hit = candidates.find((c) => c.phone && phonesMatch(c.phone, phone))
  if (hit) {
    if (email && !hit.email) await db.contacts.updateMany({ where: { id: hit.id }, data: { email } }).catch(() => {})
    return hit.id
  }
  const created = await db.contacts.create({ data: { workspace_id: wsId, name, phone, email }, select: { id: true } })
  return created.id
}

export async function placeStoreOrder(store: PublicStore, input: CheckoutInput): Promise<PlaceStoreResult> {
  const ws = store.workspace
  const db = tenantDb(ws.id)
  const priced = await priceItems(ws, input.items)
  if (!priced.ok) return priced

  const { shipping, payments } = await loadCheckoutOptions(ws.id)
  const payment = payments.find((p) => p.id === input.payment_method_id)
  if (!payment) return { ok: false, error: 'payment' }

  let fee = 0
  let profile: ShippingProfile | null = null
  if (input.fulfillment === 'delivery') {
    profile = shipping.find((s) => s.id === input.shipping_profile_id) ?? null
    if (!profile) return { ok: false, error: 'shipping' }
    const q = quoteShipping(profile, priced.subtotal, priced.weightKg)
    if (!q.ok) return { ok: false, error: 'too_heavy' }
    fee = q.fee
  } else if (!store.store.pickup_enabled) {
    return { ok: false, error: 'pickup' }
  }

  const minOrder = Math.max(0, Number((ws.settings?.orders as { min_order?: number } | undefined)?.min_order ?? 0) || 0)
  if (minOrder && priced.subtotal < minOrder) return { ok: false, error: 'min_order' }

  const fees = orderFees(store.store.fees, input.fee_ids, input.fulfillment)
  const onDelivery = profile?.type === 'on_delivery'
  const contactId = await contactFor(ws.id, input.customer.name, input.customer.phone, input.customer.email)
  const token = crypto.randomBytes(18).toString('base64url')
  const total = round2(priced.subtotal + fee + fees.total)
  const order = await db.orders.create({
    data: {
      workspace_id: ws.id,
      contact_id: contactId,
      fulfillment: input.fulfillment,
      customer_name: input.customer.name,
      customer_phone: input.customer.phone,
      customer_email: input.customer.email,
      customer_document: input.customer.document,
      address: input.address ? addressLine(input.address) : null,
      address_reference: input.address?.reference ?? null,
      shipping_address: input.address ? { ...input.address } : undefined,
      shipping_profile_id: profile?.id ?? null,
      shipping_name: profile?.name ?? null,
      weight_kg: priced.weightKg,
      notes: input.notes,
      currency: ws.currency,
      subtotal: priced.subtotal,
      delivery_fee: fee,
      shipping_on_delivery: onDelivery,
      extra_fees: fees.lines,
      fees_total: fees.total,
      total,
      payment_method_id: payment.id,
      payment_method_name: payment.name,
      payment_status: payment.requires_proof ? 'awaiting_proof' : 'unpaid',
      source: 'store',
      public_token: token,
      created_by: null,
    },
    select: { id: true, number: true },
  })
  await db.order_items.createMany({
    data: priced.lines.map((l, i) => ({
      workspace_id: ws.id,
      order_id: order.id,
      product_id: l.productId,
      variant_id: l.variantId,
      name: l.variantName ? `${l.name} (${l.variantName})` : l.name,
      variant_name: l.variantName,
      sku: l.sku,
      quantity: l.quantity,
      unit_price: l.unitPrice,
      total: round2(l.unitPrice * l.quantity),
      sort_order: i,
    })),
  })
  await db.order_events.create({ data: { workspace_id: ws.id, order_id: order.id, type: 'created', to_value: 'pending', note: 'store' } })

  const number = Number(order.number)
  await notifyTeam(ws, order.id, number, input.customer.name, total).catch((err) => console.error('[store] notify failed:', err instanceof Error ? err.message : err))
  if (input.customer.email) {
    await emailCustomer(store, input, { number, token, total, fee, onDelivery, fees: fees.lines, subtotal: priced.subtotal, lines: priced.lines, payment }).catch((err) =>
      console.error('[store] email failed:', err instanceof Error ? err.message : err),
    )
  }
  return { ok: true, number, token, total }
}

export async function notifyTeam(ws: StoreWorkspace, orderId: string, number: number, customer: string, total: number) {
  const db = tenantDb(ws.id)
  const members = await db.workspace_members.findMany({ where: { status: 'active' }, select: { user_id: true } })
  if (!members.length) return
  const money = storeMoney(ws)
  const en = ws.locale === 'en'
  await db.notifications.createMany({
    data: members.map((m) => ({
      workspace_id: ws.id,
      user_id: m.user_id,
      type: 'order',
      title: en ? `New store order #${number}` : `Nuevo pedido de la tienda #${number}`,
      body: `${customer} · ${money(total)}`,
      link: `/orders?order=${orderId}`,
    })),
  })
}

export function orderPagePath(slug: string, token: string): string {
  return `/tienda/${encodeURIComponent(slug)}/pedido/${encodeURIComponent(token)}`
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

async function emailCustomer(
  store: PublicStore,
  input: CheckoutInput,
  o: { number: number; token: string; total: number; fee: number; onDelivery: boolean; fees: { name: string; amount: number }[]; subtotal: number; lines: PricedLine[]; payment: StorePaymentMethod },
) {
  if (!emailConfigured() || !input.customer.email) return
  const ws = store.workspace
  const en = ws.locale === 'en'
  const money = storeMoney(ws)
  const site = (process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3001').replace(/\/+$/, '')
  const link = site + orderPagePath(ws.slug, o.token)
  const rows = o.lines
    .map((l) => `<tr><td style="padding:4px 0">${l.quantity} × ${esc(l.variantName ? `${l.name} (${l.variantName})` : l.name)}</td><td style="padding:4px 0;text-align:right">${esc(money(l.unitPrice * l.quantity))}</td></tr>`)
    .join('')
  const t = en
    ? { subject: `Your order #${o.number} at ${ws.name}`, hi: `Hi ${input.customer.name}, we received your order.`, ship: 'Shipping', onDelivery: 'paid on delivery', total: 'Total', pay: 'Payment', view: 'See your order and how to pay' }
    : { subject: `Tu pedido #${o.number} en ${ws.name}`, hi: `Hola ${input.customer.name}, recibimos tu pedido.`, ship: 'Envío', onDelivery: 'se paga en destino', total: 'Total', pay: 'Pago', view: 'Ver tu pedido y cómo pagar' }
  const feeRows = o.fees
    .map((f) => `<tr><td style="padding:4px 0">${esc(f.name)}</td><td style="padding:4px 0;text-align:right">${esc(money(f.amount))}</td></tr>`)
    .join('')
  const html = `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#0f172a">
<h2 style="margin:0 0 8px">${esc(ws.name)} · #${o.number}</h2>
<p>${esc(t.hi)}</p>
<table style="width:100%;border-collapse:collapse;font-size:14px">${rows}
<tr><td style="padding:4px 0;border-top:1px solid #e2e8f0">${t.ship}</td><td style="padding:4px 0;text-align:right;border-top:1px solid #e2e8f0">${o.onDelivery ? t.onDelivery : esc(money(o.fee))}</td></tr>${feeRows}
<tr><td style="padding:4px 0"><b>${t.total}</b></td><td style="padding:4px 0;text-align:right"><b>${esc(money(o.total))}</b></td></tr></table>
<p>${t.pay}: ${esc(o.payment.name)}${o.payment.instructions ? `<br>${esc(o.payment.instructions)}` : ''}</p>
<p><a href="${esc(link)}" style="display:inline-block;background:${store.store.accent};color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">${t.view}</a></p>
</div>`
  await sendEmail({ to: input.customer.email, subject: t.subject, html, text: `${t.hi}\n#${o.number} · ${t.total}: ${money(o.total)}\n${link}` })
}

// ------------------------------------------------------------
// The customer's order page
// ------------------------------------------------------------
export interface PublicOrder {
  number: number
  status: string
  payment_status: string
  fulfillment: string
  customer_name: string | null
  address: string | null
  shipping_name: string | null
  subtotal: number
  delivery_fee: number
  shipping_on_delivery: boolean
  fees: { name: string; amount: number }[]
  total: number
  created_at: string | null
  items: { name: string; quantity: number; total: number }[]
  payment: StorePaymentMethod | null
  /** Service orders: the appointment made at checkout. */
  booking: { date: string; time: string; staff: string | null; status: string | null } | null
}

/** 'YYYY-MM-DD' whether the date column arrives as a string or a Date. */
const isoDay = (d: unknown) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10))

export async function loadPublicOrder(store: PublicStore, token: string): Promise<PublicOrder | null> {
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(token)) return null
  const db = tenantDb(store.workspace.id)
  const o = await db.orders.findFirst({
    where: { public_token: token, source: 'store' },
    select: {
      number: true,
      status: true,
      payment_status: true,
      fulfillment: true,
      customer_name: true,
      address: true,
      shipping_name: true,
      subtotal: true,
      delivery_fee: true,
      shipping_on_delivery: true,
      extra_fees: true,
      total: true,
      created_at: true,
      payment_method_id: true,
      bookings: { select: { booking_date: true, booking_time: true, status: true, staff: { select: { name: true } } } },
      order_items: { select: { name: true, quantity: true, total: true }, orderBy: { sort_order: 'asc' } },
    },
  })
  if (!o) return null
  const payment =
    o.payment_method_id && isUuid(o.payment_method_id)
      ? await db.payment_methods.findFirst({
          where: { id: o.payment_method_id },
          select: { id: true, name: true, type: true, instructions: true, qr_image_url: true, requires_proof: true },
        })
      : null
  return {
    number: Number(o.number),
    status: o.status,
    payment_status: o.payment_status,
    fulfillment: o.fulfillment,
    customer_name: o.customer_name,
    address: o.address,
    shipping_name: o.shipping_name,
    subtotal: Number(o.subtotal),
    delivery_fee: Number(o.delivery_fee),
    shipping_on_delivery: o.shipping_on_delivery,
    fees: Array.isArray(o.extra_fees) ? (o.extra_fees as { name: string; amount: number }[]).map((f) => ({ name: String(f.name), amount: Number(f.amount) || 0 })) : [],
    total: Number(o.total),
    created_at: o.created_at ? new Date(o.created_at).toISOString() : null,
    items: o.order_items.map((i) => ({ name: i.name, quantity: i.quantity, total: Number(i.total) })),
    payment,
    booking: o.bookings
      ? { date: isoDay(o.bookings.booking_date), time: String(o.bookings.booking_time).slice(0, 5), staff: o.bookings.staff?.name ?? null, status: o.bookings.status ?? null }
      : null,
  }
}

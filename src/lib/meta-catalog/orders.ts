import 'server-only'
import crypto from 'node:crypto'
import { prisma } from '@/lib/db/prisma'
import { tenantDb } from '@/lib/db/tenant'
import { sendMessage } from '@/lib/messaging/send'
import { siteUrl } from '@/lib/real-estate/listing/url'
import { storePath, storeSettings } from '@/lib/store/settings'
import { notifyTeam, priceItems, storeMoney, type PriceResult, type StoreWorkspace } from '@/lib/store/server'
import type { CheckoutItem } from '@/lib/store/checkout'
import type { WorkspaceSettings } from '@/lib/workspace/types'
import { parseWaOrder } from './items'

// A cart sent from the business's WhatsApp catalog (webhook message type
// "order"): it becomes a pending order in Pedidos, and the customer gets the
// summary and a link to the store's checkout to pick shipping and payment
// (checkout_pending until they do).

const round2 = (n: number) => Math.round(n * 100) / 100

export const checkoutLink = (slug: string, token: string) => `${siteUrl()}${storePath(slug)}/checkout?pedido=${encodeURIComponent(token)}`

async function storeWorkspace(id: string): Promise<StoreWorkspace | null> {
  const ws = await prisma.workspaces.findUnique({
    where: { id },
    select: { id: true, name: true, slug: true, industry: true, country: true, currency: true, locale: true, description: true, phone: true, logo_url: true, settings: true },
  })
  return ws ? { ...ws, locale: ws.locale === 'en' ? 'en' : 'es', settings: (ws.settings ?? {}) as WorkspaceSettings } : null
}

/** Our product/variant for each retailer id of the cart (variant ids first, then product ids). */
async function resolveItems(wsId: string, items: { retailerId: string; quantity: number }[]): Promise<{ lines: CheckoutItem[]; unknown: number }> {
  const db = tenantDb(wsId)
  const ids = items.map((i) => i.retailerId).filter((id) => /^[0-9a-f-]{36}$/i.test(id))
  const [variants, products] = await Promise.all([
    ids.length ? db.product_variants.findMany({ where: { id: { in: ids } }, select: { id: true, product_id: true } }) : [],
    ids.length ? db.products.findMany({ where: { id: { in: ids } }, select: { id: true } }) : [],
  ])
  const byVariant = new Map(variants.map((v) => [v.id, v.product_id]))
  const productIds = new Set(products.map((p) => p.id))
  const merged = new Map<string, CheckoutItem>()
  let unknown = 0
  for (const it of items) {
    const productId = byVariant.get(it.retailerId) ?? (productIds.has(it.retailerId) ? it.retailerId : null)
    if (!productId) {
      unknown++
      continue
    }
    const variantId = byVariant.has(it.retailerId) ? it.retailerId : null
    const key = `${productId}:${variantId ?? ''}`
    const prev = merged.get(key)
    merged.set(key, { product_id: productId, variant_id: variantId, quantity: (prev?.quantity ?? 0) + it.quantity })
  }
  return { lines: [...merged.values()], unknown }
}

export interface CatalogOrderInput {
  workspaceId: string
  conversationId: string
  contactId: string
  order: unknown
}

/** Handles the cart; true = answered (the AI and flows don't run). */
export async function handleCatalogOrder(input: CatalogOrderInput): Promise<boolean> {
  const parsed = parseWaOrder(input.order)
  if (!parsed) return false
  const ws = await storeWorkspace(input.workspaceId)
  if (!ws) return false
  const db = tenantDb(ws.id)
  const en = ws.locale === 'en'
  const money = storeMoney(ws)
  const say = (text: string, metadata: Record<string, unknown> = {}) =>
    sendMessage({ workspaceId: ws.id, conversationId: input.conversationId, content: { type: 'text', text }, sender: { type: 'bot' }, metadata: { source: 'whatsapp_catalog', ...metadata } })

  const { lines, unknown } = await resolveItems(ws.id, parsed.items)
  const priced: PriceResult = lines.length ? await priceItems(ws, lines) : { ok: false, error: 'unavailable' }
  if (!priced.ok) {
    const what = priced.name ? ` (${priced.name})` : ''
    await say(
      priced.error === 'stock'
        ? en
          ? `Sorry, we don't have enough stock${what} for your order. Change the quantity in the cart and send it again, or write to us.`
          : `Lo sentimos, no tenemos stock suficiente${what} para tu pedido. Cambia la cantidad en el carrito y envíalo de nuevo, o escríbenos.`
        : en
          ? `Sorry, a product in your cart${what} is no longer available. Remove it and send the cart again, or write to us.`
          : `Lo sentimos, un producto de tu carrito${what} ya no está disponible. Quítalo y vuelve a enviar el carrito, o escríbenos.`,
    )
    return true
  }

  const contact = await db.contacts.findFirst({ where: { id: input.contactId }, select: { name: true, phone: true } })
  const phoneDigits = (contact?.phone ?? '').replace(/\D/g, '')
  const name = contact?.name && contact.name.replace(/\D/g, '') !== phoneDigits ? contact.name : en ? 'WhatsApp customer' : 'Cliente de WhatsApp'
  const token = crypto.randomBytes(18).toString('base64url')
  const order = await db.orders.create({
    data: {
      workspace_id: ws.id,
      contact_id: input.contactId,
      conversation_id: input.conversationId,
      fulfillment: 'delivery',
      customer_name: name,
      customer_phone: phoneDigits || null,
      weight_kg: priced.weightKg,
      notes: parsed.text,
      currency: ws.currency,
      subtotal: priced.subtotal,
      delivery_fee: 0,
      total: priced.subtotal,
      payment_status: 'unpaid',
      source: 'whatsapp_catalog',
      checkout_pending: true,
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
  await db.order_events.create({ data: { workspace_id: ws.id, order_id: order.id, type: 'created', to_value: 'pending', note: 'whatsapp_catalog' } })
  const number = Number(order.number)
  await notifyTeam(ws, order.id, number, name, priced.subtotal).catch((err) => console.error('[meta-catalog] notify failed:', err instanceof Error ? err.message : err))

  const rows = priced.lines.map((l) => `• ${l.quantity} × ${l.variantName ? `${l.name} (${l.variantName})` : l.name} — ${money(round2(l.unitPrice * l.quantity))}`).join('\n')
  const store = storeSettings(ws.settings?.store)
  const skipped = unknown ? (en ? `\n(${unknown} product(s) of the cart are no longer sold and were left out.)` : `\n(${unknown} producto(s) del carrito ya no se venden y no se incluyeron.)`) : ''
  const next = store.enabled
    ? en
      ? `Choose shipping and how to pay here 👉 ${checkoutLink(ws.slug, token)}`
      : `Elige el envío y cómo pagar aquí 👉 ${checkoutLink(ws.slug, token)}`
    : en
      ? 'We will write to you to arrange shipping and payment.'
      : 'Te escribimos para coordinar el envío y el pago.'
  await say(
    en
      ? `Thanks! We received your order #${number}:\n${rows}\nSubtotal: ${money(priced.subtotal)}${skipped}\n\n${next}`
      : `¡Gracias! Recibimos tu pedido #${number}:\n${rows}\nSubtotal: ${money(priced.subtotal)}${skipped}\n\n${next}`,
    { order_id: order.id },
  )
  return true
}

// ------------------------------------------------------------------
// The store's checkout, opened from that link
// ------------------------------------------------------------------
export interface PendingCheckout {
  token: string
  number: number
  customer: { name: string; phone: string }
  lines: { product_id: string; variant_id: string | null; name: string; variant_name: string | null; price: number; image: string | null; quantity: number }[]
}

/** The WhatsApp order still waiting for shipping and payment, for the checkout form. */
export async function loadPendingCheckout(ws: { id: string }, token: string): Promise<PendingCheckout | null> {
  if (!token || token.length > 64) return null
  const db = tenantDb(ws.id)
  const order = await db.orders.findFirst({
    where: { public_token: token, source: 'whatsapp_catalog', checkout_pending: true, status: 'pending' },
    select: {
      public_token: true,
      number: true,
      customer_name: true,
      customer_phone: true,
      order_items: { select: { product_id: true, variant_id: true, name: true, variant_name: true, unit_price: true, quantity: true, products: { select: { name: true, images: true } } }, orderBy: { sort_order: 'asc' } },
    },
  })
  if (!order) return null
  return {
    token: order.public_token!,
    number: Number(order.number),
    customer: { name: order.customer_name ?? '', phone: order.customer_phone ?? '' },
    lines: order.order_items
      .filter((l) => l.product_id)
      .map((l) => ({
        product_id: l.product_id!,
        variant_id: l.variant_id,
        name: l.products?.name ?? l.name,
        variant_name: l.variant_name,
        price: Number(l.unit_price),
        image: l.products?.images.find((u) => /^https?:\/\//.test(u)) ?? null,
        quantity: l.quantity,
      })),
  }
}

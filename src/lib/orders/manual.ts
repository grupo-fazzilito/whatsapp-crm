import 'server-only'
import { tenantDb } from '@/lib/db/tenant'
import { isUuid } from '@/lib/workspace/constants'
import { cartCurrencyConflict } from '@/lib/catalog/currency'
import { getPreset } from '@/lib/industries'
import type { Workspace } from '@/lib/workspace/types'
import { computeTotals, orderSettings } from './service'
import type { CartLine, Fulfillment } from './texts'

export interface ManualItemInput {
  product_id: string
  variant_id?: string | null
  quantity: number
}

export type ManualOrderResult =
  | { ok: true; order: { id: string; number: number } }
  | { ok: false; error: 'contact_not_found' | 'empty' | 'fulfillment_not_allowed' | 'address_required' | 'unavailable' | 'price_on_request' | 'foreign_currency'; detail?: string }

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * Creates a pending order typed in by the team. Names and prices come from
 * the current catalog (never from the client). The order is linked to the
 * contact's most recent conversation so status updates reach the customer.
 */
export async function createManualOrder(args: {
  workspace: Workspace
  userId: string
  contactId: string
  items: ManualItemInput[]
  fulfillment: Fulfillment
  address?: string | null
  addressReference?: string | null
  notes?: string | null
}): Promise<ManualOrderResult> {
  const ws = args.workspace
  const db = tenantDb(ws.id)
  const settings = orderSettings(ws, getPreset(ws.industry).fulfillment as Fulfillment[])
  if (!settings.fulfillment.includes(args.fulfillment)) return { ok: false, error: 'fulfillment_not_allowed' }
  if (args.fulfillment === 'delivery' && !args.address?.trim()) return { ok: false, error: 'address_required' }
  if (!args.items.length) return { ok: false, error: 'empty' }

  const contact = isUuid(args.contactId)
    ? await db.contacts.findFirst({ select: { id: true, name: true, phone: true }, where: { id: args.contactId } })
    : null
  if (!contact) return { ok: false, error: 'contact_not_found' }

  const productIds = [...new Set(args.items.map((i) => i.product_id))]
  const variantIds = [...new Set(args.items.map((i) => i.variant_id).filter((v): v is string => !!v))]
  // A malformed id made PostgREST fail the whole query (no rows).
  const products = productIds.every(isUuid)
    ? await db.products.findMany({ select: { id: true, name: true, sku: true, price: true, currency: true, is_active: true }, where: { id: { in: productIds } } })
    : []
  const variants = variantIds.length && variantIds.every(isUuid)
    ? await db.product_variants.findMany({ select: { id: true, product_id: true, name: true, sku: true, price: true, is_active: true }, where: { id: { in: variantIds } } })
    : []

  const lines: (CartLine & { productId: string; variantId: string | null; variantName: string | null; sku: string | null })[] = []
  for (const item of args.items) {
    const p = products?.find((x) => x.id === item.product_id)
    if (!p || !p.is_active) return { ok: false, error: 'unavailable' }
    const v = item.variant_id ? variants?.find((x) => x.id === item.variant_id && x.product_id === p.id) : null
    if (item.variant_id && (!v || !v.is_active)) return { ok: false, error: 'unavailable', detail: p.name }
    const price = v?.price ?? p.price
    if (price === null || price === undefined) return { ok: false, error: 'price_on_request', detail: p.name }
    // Orders are in the workspace currency only.
    if (cartCurrencyConflict(p, ws.currency)) return { ok: false, error: 'foreign_currency', detail: p.name }
    const quantity = Math.min(999, Math.max(1, Math.round(item.quantity)))
    const existing = lines.find((l) => l.productId === p.id && l.variantId === (v?.id ?? null))
    if (existing) {
      existing.quantity = Math.min(999, existing.quantity + quantity)
      continue
    }
    lines.push({
      productId: p.id,
      variantId: v?.id ?? null,
      name: p.name,
      variantName: v?.name ?? null,
      sku: v?.sku ?? p.sku ?? null,
      quantity,
      unitPrice: Number(price),
    })
  }

  const totals = computeTotals(lines, settings, args.fulfillment)

  const conv = await db.conversations.findFirst({
    select: { id: true, channel_id: true },
    where: { contact_id: contact.id },
    orderBy: { last_message_at: { sort: 'desc', nulls: 'last' } },
  })

  const customerName = contact.name && !/^\+?\d+$/.test(contact.name) ? contact.name : null
  const order = await db.orders.create({
    data: {
      workspace_id: ws.id,
      contact_id: contact.id,
      conversation_id: conv?.id ?? null,
      channel_id: conv?.channel_id ?? null,
      fulfillment: args.fulfillment,
      customer_name: customerName,
      customer_phone: contact.phone ?? null,
      address: args.fulfillment === 'delivery' ? args.address?.trim() || null : null,
      address_reference: args.addressReference?.trim() || null,
      notes: args.notes?.trim() || null,
      currency: ws.currency,
      subtotal: totals.subtotal,
      delivery_fee: totals.deliveryFee,
      total: totals.total,
      source: 'manual',
      created_by: args.userId,
    },
    select: { id: true, number: true },
  })

  try {
    await db.order_items.createMany({
      data: lines.map((l, i) => ({
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
  } catch (itemsError) {
    await db.orders.deleteMany({ where: { id: order.id } })
    throw itemsError
  }
  await db.order_events.create({ data: { workspace_id: ws.id, order_id: order.id, type: 'created', to_value: 'pending', note: 'manual', user_id: args.userId } })
  return { ok: true, order: { id: order.id, number: Number(order.number) } }
}

import 'server-only'
import { supabaseAdmin } from '@/lib/supabase/admin'
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
  const db = supabaseAdmin()
  const ws = args.workspace
  const settings = orderSettings(ws, getPreset(ws.industry).fulfillment as Fulfillment[])
  if (!settings.fulfillment.includes(args.fulfillment)) return { ok: false, error: 'fulfillment_not_allowed' }
  if (args.fulfillment === 'delivery' && !args.address?.trim()) return { ok: false, error: 'address_required' }
  if (!args.items.length) return { ok: false, error: 'empty' }

  const { data: contact } = await db
    .from('contacts')
    .select('id, name, phone')
    .eq('id', args.contactId)
    .eq('workspace_id', ws.id)
    .maybeSingle()
  if (!contact) return { ok: false, error: 'contact_not_found' }

  const productIds = [...new Set(args.items.map((i) => i.product_id))]
  const variantIds = [...new Set(args.items.map((i) => i.variant_id).filter((v): v is string => !!v))]
  const { data: products } = await db
    .from('products')
    .select('id, name, sku, price, currency, is_active')
    .eq('workspace_id', ws.id)
    .in('id', productIds)
  const { data: variants } = variantIds.length
    ? await db.from('product_variants').select('id, product_id, name, sku, price, is_active').in('id', variantIds)
    : { data: [] as { id: string; product_id: string; name: string; sku: string | null; price: number | null; is_active: boolean }[] }

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

  const { data: conv } = await db
    .from('conversations')
    .select('id, channel_id')
    .eq('workspace_id', ws.id)
    .eq('contact_id', contact.id)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle()

  const customerName = contact.name && !/^\+?\d+$/.test(contact.name) ? contact.name : null
  const { data: order, error } = await db
    .from('orders')
    .insert({
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
    })
    .select('id, number')
    .single()
  if (error || !order) throw error ?? new Error('order insert failed')

  const { error: itemsError } = await db.from('order_items').insert(
    lines.map((l, i) => ({
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
  )
  if (itemsError) {
    await db.from('orders').delete().eq('id', order.id)
    throw itemsError
  }
  await db.from('order_events').insert({ workspace_id: ws.id, order_id: order.id, type: 'created', to_value: 'pending', note: 'manual', user_id: args.userId })
  return { ok: true, order: { id: order.id, number: Number(order.number) } }
}

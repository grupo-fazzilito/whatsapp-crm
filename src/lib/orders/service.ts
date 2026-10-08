import 'server-only'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { cartCurrencyConflict } from '@/lib/catalog/currency'
import { sendMessage } from '@/lib/messaging/send'
import { invalidateBusinessContext } from '@/lib/ai/context'
import { formatMoney, moneyLocale } from '@/lib/workspace/countries'
import type { Workspace } from '@/lib/workspace/types'
import { statusMessage, texts, type CartLine, type Fulfillment, type Lang, type OrderStatus } from './texts'

// ------------------------------------------------------------
// Settings (workspaces.settings.orders)
// ------------------------------------------------------------
export interface OrderSettings {
  fulfillment: Fulfillment[]
  deliveryFee: number
  minOrder: number
  /** Message the customer on every status change. */
  notifyStatus: boolean
}

export function orderSettings(ws: Pick<Workspace, 'settings'>, presetFulfillment: Fulfillment[] = ['pickup', 'delivery']): OrderSettings {
  const raw = (ws.settings?.orders ?? {}) as Partial<{ fulfillment: Fulfillment[]; delivery_fee: number; min_order: number; notify_status: boolean }>
  const allowed: Fulfillment[] = ['pickup', 'delivery', 'dine_in']
  const fulfillment = (Array.isArray(raw.fulfillment) ? raw.fulfillment : presetFulfillment).filter((f) => allowed.includes(f))
  return {
    fulfillment: fulfillment.length ? fulfillment : ['pickup'],
    deliveryFee: Math.max(0, Number(raw.delivery_fee ?? 0) || 0),
    minOrder: Math.max(0, Number(raw.min_order ?? 0) || 0),
    notifyStatus: raw.notify_status !== false,
  }
}

export function moneyFor(ws: Pick<Workspace, 'currency' | 'locale' | 'country'>) {
  return (n: number) => formatMoney(n, ws.currency, moneyLocale(ws))
}

export function langFor(ws: Pick<Workspace, 'locale'>): Lang {
  return ws.locale === 'en' ? 'en' : 'es'
}

// ------------------------------------------------------------
// Cart
// ------------------------------------------------------------
export interface CartCheckout {
  step?: 'fulfillment' | 'address' | 'name' | 'review'
  fulfillment?: Fulfillment
  address?: string
  address_reference?: string
  customer_name?: string
  notes?: string
}

export interface Cart {
  id: string
  workspace_id: string
  conversation_id: string | null
  contact_id: string | null
  checkout: CartCheckout
}

export interface CartItemView extends CartLine {
  id: string
  productId: string
  variantId: string | null
  imageUrl: string | null
  trackStock: boolean
  available: number | null
}

export async function getOpenCart(
  workspaceId: string,
  conversationId: string,
  contactId: string | null,
  create: boolean,
): Promise<Cart | null> {
  const db = supabaseAdmin()
  const { data } = await db
    .from('carts')
    .select('id, workspace_id, conversation_id, contact_id, checkout')
    .eq('workspace_id', workspaceId)
    .eq('conversation_id', conversationId)
    .eq('status', 'open')
    .maybeSingle()
  if (data || !create) return (data as Cart) ?? null
  const { data: created, error } = await db
    .from('carts')
    .insert({ workspace_id: workspaceId, conversation_id: conversationId, contact_id: contactId })
    .select('id, workspace_id, conversation_id, contact_id, checkout')
    .single()
  if (error) {
    // Concurrent create (unique open cart per conversation): read the winner.
    return getOpenCart(workspaceId, conversationId, contactId, false)
  }
  return created as Cart
}

export async function cartItems(cartId: string): Promise<CartItemView[]> {
  const { data } = await supabaseAdmin()
    .from('cart_items')
    .select('id, quantity, product_id, variant_id, product:products(name, price, currency, images, track_stock, stock, is_active, workspace:workspaces(currency)), variant:product_variants(name, price, stock, is_active)')
    .eq('cart_id', cartId)
    .order('created_at')
  const out: CartItemView[] = []
  for (const row of data ?? []) {
    const p = row.product as unknown as { name: string; price: number | null; currency: string | null; images: string[]; track_stock: boolean; stock: number | null; is_active: boolean; workspace: { currency: string } | null } | null
    const v = row.variant as unknown as { name: string; price: number | null; stock: number | null; is_active: boolean } | null
    if (!p || !p.is_active || (v && !v.is_active)) continue
    // Priced in another currency since it was added: not orderable.
    if (cartCurrencyConflict(p, p.workspace?.currency ?? '')) continue
    const price = v?.price ?? p.price
    if (price === null || price === undefined) continue
    out.push({
      id: row.id,
      productId: row.product_id,
      variantId: row.variant_id,
      name: v ? `${p.name} (${v.name})` : p.name,
      quantity: row.quantity,
      unitPrice: Number(price),
      imageUrl: p.images?.[0] ?? null,
      trackStock: p.track_stock,
      available: p.track_stock ? (v && v.stock !== null ? v.stock : p.stock ?? 0) : null,
    })
  }
  return out
}

export function computeTotals(lines: CartLine[], settings: OrderSettings, fulfillment?: Fulfillment) {
  const subtotal = round2(lines.reduce((a, l) => a + l.unitPrice * l.quantity, 0))
  const deliveryFee = fulfillment === 'delivery' ? settings.deliveryFee : 0
  return { subtotal, deliveryFee, total: round2(subtotal + deliveryFee) }
}

const round2 = (n: number) => Math.round(n * 100) / 100

export type AddResult =
  | { ok: true; name: string; quantity: number }
  | { ok: false; reason: 'unavailable' | 'price_on_request' | 'out_of_stock' | 'not_enough'; name?: string; available?: number }
  | { ok: false; reason: 'foreign_currency'; name: string; currency: string }

/** Adds (or increases) a line. Checks availability, price and stock. */
export async function addToCart(cart: Cart, productId: string, variantId: string | null, quantity: number): Promise<AddResult> {
  const db = supabaseAdmin()
  const { data: p } = await db
    .from('products')
    .select('id, name, price, currency, track_stock, stock, is_active, workspace:workspaces(currency)')
    .eq('id', productId)
    .eq('workspace_id', cart.workspace_id)
    .maybeSingle()
  if (!p || !p.is_active) return { ok: false, reason: 'unavailable' }
  // Orders are in the workspace currency: a listing priced in another
  // currency (e.g. a USD sale in a PEN workspace) is quoted by a person.
  const wsCurrency = (p.workspace as unknown as { currency: string } | null)?.currency ?? ''
  const foreign = cartCurrencyConflict(p, wsCurrency)
  if (foreign) return { ok: false, reason: 'foreign_currency', name: p.name, currency: foreign }
  let v: { id: string; name: string; price: number | null; stock: number | null; is_active: boolean } | null = null
  if (variantId) {
    const { data } = await db.from('product_variants').select('id, name, price, stock, is_active').eq('id', variantId).eq('product_id', productId).maybeSingle()
    if (!data || !data.is_active) return { ok: false, reason: 'unavailable', name: p.name }
    v = data
  }
  const name = v ? `${p.name} (${v.name})` : p.name
  if ((v?.price ?? p.price) === null) return { ok: false, reason: 'price_on_request', name }

  const { data: existing } = await db
    .from('cart_items')
    .select('id, quantity')
    .eq('cart_id', cart.id)
    .eq('product_id', productId)
    .filter('variant_id', variantId ? 'eq' : 'is', variantId ?? null)
    .maybeSingle()
  const next = Math.min(999, (existing?.quantity ?? 0) + Math.max(1, Math.round(quantity)))

  if (p.track_stock) {
    const available = v && v.stock !== null ? v.stock : p.stock ?? 0
    if (available <= 0) return { ok: false, reason: 'out_of_stock', name }
    if (next > available) return { ok: false, reason: 'not_enough', name, available }
  }

  if (existing) await db.from('cart_items').update({ quantity: next }).eq('id', existing.id)
  else await db.from('cart_items').insert({ workspace_id: cart.workspace_id, cart_id: cart.id, product_id: productId, variant_id: variantId, quantity: next })
  await db.from('carts').update({ updated_at: new Date().toISOString() }).eq('id', cart.id)
  return { ok: true, name, quantity: Math.max(1, Math.round(quantity)) }
}

export async function setLineQuantity(cart: Cart, productId: string, variantId: string | null, quantity: number) {
  const db = supabaseAdmin()
  let q = db.from('cart_items').select('id').eq('cart_id', cart.id).eq('product_id', productId)
  q = variantId ? q.eq('variant_id', variantId) : q.is('variant_id', null)
  const { data } = await q.maybeSingle()
  if (!data) return
  if (quantity <= 0) await db.from('cart_items').delete().eq('id', data.id)
  else await db.from('cart_items').update({ quantity: Math.min(999, Math.round(quantity)) }).eq('id', data.id)
}

export async function clearCart(cart: Cart) {
  const db = supabaseAdmin()
  await db.from('cart_items').delete().eq('cart_id', cart.id)
  await db.from('carts').update({ checkout: {} }).eq('id', cart.id)
}

export async function saveCheckout(cart: Cart, patch: Partial<CartCheckout>): Promise<CartCheckout> {
  const next = { ...(cart.checkout ?? {}), ...patch }
  await supabaseAdmin().from('carts').update({ checkout: next }).eq('id', cart.id)
  cart.checkout = next
  return next
}

// ------------------------------------------------------------
// Orders
// ------------------------------------------------------------
export interface PlacedOrder {
  id: string
  number: number
  total: number
  fulfillment: Fulfillment
}

export type PlaceResult = { ok: true; order: PlacedOrder } | { ok: false; reason: 'empty' | 'min_order' | 'stock'; detail?: string }

/** Turns the open cart into a pending order (prices and names copied). */
export async function placeOrderFromCart(args: {
  workspace: Workspace
  cart: Cart
  channelId: string | null
  source: 'ai' | 'chat_buttons' | 'webchat'
  aiAgentId?: string | null
  settings: OrderSettings
}): Promise<PlaceResult> {
  const db = supabaseAdmin()
  const lines = await cartItems(args.cart.id)
  if (!lines.length) return { ok: false, reason: 'empty' }
  for (const l of lines) {
    if (l.trackStock && (l.available ?? 0) < l.quantity) return { ok: false, reason: 'stock', detail: l.name }
  }
  const checkout = args.cart.checkout ?? {}
  const fulfillment = checkout.fulfillment ?? args.settings.fulfillment[0]
  const totals = computeTotals(lines, args.settings, fulfillment)
  if (args.settings.minOrder && totals.subtotal < args.settings.minOrder) return { ok: false, reason: 'min_order' }

  let customerPhone: string | null = null
  if (args.cart.contact_id) {
    const { data: c } = await db.from('contacts').select('phone, name').eq('id', args.cart.contact_id).maybeSingle()
    customerPhone = c?.phone ?? null
    if (!checkout.customer_name && c?.name && !/^\+?\d+$/.test(c.name)) checkout.customer_name = c.name
  }

  const { data: order, error } = await db
    .from('orders')
    .insert({
      workspace_id: args.workspace.id,
      contact_id: args.cart.contact_id,
      conversation_id: args.cart.conversation_id,
      channel_id: args.channelId,
      cart_id: args.cart.id,
      fulfillment,
      customer_name: checkout.customer_name ?? null,
      customer_phone: customerPhone,
      address: fulfillment === 'delivery' ? checkout.address ?? null : null,
      address_reference: checkout.address_reference ?? null,
      notes: checkout.notes ?? null,
      currency: args.workspace.currency,
      subtotal: totals.subtotal,
      delivery_fee: totals.deliveryFee,
      total: totals.total,
      source: args.source,
      ai_agent_id: args.aiAgentId ?? null,
      created_by: null,
    })
    .select('id, number, total, fulfillment')
    .single()
  if (error || !order) throw error ?? new Error('order insert failed')

  await db.from('order_items').insert(
    lines.map((l, i) => ({
      workspace_id: args.workspace.id,
      order_id: order.id,
      product_id: l.productId,
      variant_id: l.variantId,
      name: l.name,
      quantity: l.quantity,
      unit_price: l.unitPrice,
      total: round2(l.unitPrice * l.quantity),
      sort_order: i,
    })),
  )
  await db.from('order_events').insert({ workspace_id: args.workspace.id, order_id: order.id, type: 'created', to_value: 'pending', note: args.source })
  await db.from('carts').update({ status: 'converted' }).eq('id', args.cart.id)
  return { ok: true, order: { id: order.id, number: Number(order.number), total: Number(order.total), fulfillment: order.fulfillment } }
}

const STATUS_FLOW: OrderStatus[] = ['pending', 'confirmed', 'preparing', 'ready', 'shipped', 'delivered']

export type StatusResult = { ok: true } | { ok: false; error: string }

/**
 * Moves an order to `status` (confirm reserves stock, cancel restores it)
 * and tells the customer through the order's conversation.
 */
export async function updateOrderStatus(args: {
  workspaceId: string
  orderId: string
  status: OrderStatus
  userId: string | null
  reason?: string | null
  notify?: boolean
}): Promise<StatusResult> {
  const db = supabaseAdmin()
  const { data: order } = await db
    .from('orders')
    .select('id, status, number, fulfillment, conversation_id, workspace:workspaces(*)')
    .eq('id', args.orderId)
    .eq('workspace_id', args.workspaceId)
    .maybeSingle()
  if (!order) return { ok: false, error: 'not_found' }
  const ws = order.workspace as unknown as Workspace
  if (order.status === args.status) return { ok: true }
  if (order.status === 'cancelled' || order.status === 'delivered') return { ok: false, error: 'closed' }

  if (args.status === 'cancelled') {
    const { data } = await db.rpc('cancel_order', { p_order: args.orderId, p_user: args.userId, p_note: args.reason ?? null })
    if (data !== 'ok') return { ok: false, error: String(data) }
  } else if (order.status === 'pending') {
    // Leaving pending always goes through confirm (stock reservation).
    const { data } = await db.rpc('confirm_order', { p_order: args.orderId, p_user: args.userId })
    if (data !== 'ok') return { ok: false, error: String(data) }
    if (args.status !== 'confirmed') {
      await db.from('orders').update({ status: args.status }).eq('id', args.orderId)
      await db.from('order_events').insert({ workspace_id: args.workspaceId, order_id: args.orderId, type: 'status', from_value: 'confirmed', to_value: args.status, user_id: args.userId })
    }
  } else {
    if (STATUS_FLOW.indexOf(args.status) < 0) return { ok: false, error: 'invalid_status' }
    await db.from('orders').update({ status: args.status }).eq('id', args.orderId)
    await db.from('order_events').insert({ workspace_id: args.workspaceId, order_id: args.orderId, type: 'status', from_value: order.status, to_value: args.status, note: args.reason ?? null, user_id: args.userId })
  }
  invalidateBusinessContext(args.workspaceId)

  const settings = orderSettings(ws)
  if ((args.notify ?? settings.notifyStatus) && order.conversation_id) {
    const text = statusMessage(langFor(ws), args.status, order.fulfillment, Number(order.number), args.reason)
    if (text) {
      await sendMessage({
        workspaceId: args.workspaceId,
        conversationId: order.conversation_id,
        content: { type: 'text', text },
        sender: { type: 'agent', userId: args.userId },
        metadata: { order_id: args.orderId, event: 'order_status' },
      })
      await db.from('order_events').insert({ workspace_id: args.workspaceId, order_id: args.orderId, type: 'notified', to_value: args.status })
    }
  }
  return { ok: true }
}

export async function markOrderPaid(workspaceId: string, orderId: string, userId: string | null, notify = true): Promise<StatusResult> {
  const db = supabaseAdmin()
  const { data: order } = await db
    .from('orders')
    .select('id, number, payment_status, conversation_id, workspace:workspaces(locale)')
    .eq('id', orderId)
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  if (!order) return { ok: false, error: 'not_found' }
  if (order.payment_status === 'paid') return { ok: true }
  await db.from('orders').update({ payment_status: 'paid', paid_at: new Date().toISOString() }).eq('id', orderId)
  await db.from('order_events').insert({ workspace_id: workspaceId, order_id: orderId, type: 'payment', from_value: order.payment_status, to_value: 'paid', user_id: userId })
  if (notify && order.conversation_id) {
    const lang = langFor(order.workspace as unknown as Workspace)
    await sendMessage({
      workspaceId,
      conversationId: order.conversation_id,
      content: { type: 'text', text: texts(lang).paid.replace('{number}', String(order.number)) },
      sender: { type: 'agent', userId },
      metadata: { order_id: orderId, event: 'order_paid' },
    })
  }
  return { ok: true }
}

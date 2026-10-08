import 'server-only'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { sendMessage } from '@/lib/messaging/send'
import { getPreset, resolveIndustry } from '@/lib/industries'
import type { CarouselCard, InteractiveOption, LoadedChannel, OutboundContent } from '@/lib/channels'
import type { Workspace } from '@/lib/workspace/types'
import { propertyUrl } from '@/lib/real-estate/listing/url'
import {
  addToCart,
  cartItems,
  clearCart,
  computeTotals,
  getOpenCart,
  langFor,
  moneyFor,
  orderSettings,
  placeOrderFromCart,
  saveCheckout,
  type Cart,
  type OrderSettings,
} from './service'
import { fill, summaryText, texts, type Fulfillment, type Lang } from './texts'
import { cartCurrencyConflict, formatProductPrice } from '@/lib/catalog/currency'

// Button ids carried back by the channels when the customer taps:
//   cart:add:<productId>[:<variantId>]  cart:more:<productId>
//   cart:view  cart:checkout  cart:clear  cart:shop
//   ful:<pickup|delivery|dine_in>  order:confirm  order:edit
//   pay:<paymentMethodId>
export const COMMERCE_PREFIXES = ['cart:', 'ful:', 'order:', 'pay:'] as const

export function isCommerceAction(id: string | null | undefined): id is string {
  return !!id && COMMERCE_PREFIXES.some((p) => id.startsWith(p))
}

export interface CommerceCtx {
  workspace: Workspace
  channel: LoadedChannel
  conversationId: string
  contactId: string
  aiAgentId?: string | null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function say(ctx: CommerceCtx, content: Parameters<typeof sendMessage>[0]['content'], metadata?: Record<string, unknown>) {
  await sendMessage({
    workspaceId: ctx.workspace.id,
    conversationId: ctx.conversationId,
    content,
    sender: { type: 'bot', aiAgentId: ctx.aiAgentId ?? null },
    metadata,
  })
}

function settingsFor(ws: Workspace): OrderSettings {
  return orderSettings(ws, getPreset(ws.industry).fulfillment as Fulfillment[])
}

/** Orders module on for this workspace? */
export function ordersEnabled(ws: Workspace): boolean {
  return resolveIndustry(ws.industry, ws.settings).modules.orders
}

/**
 * What a product card's main button does: add to cart (stores,
 * restaurants), book a visit/appointment for that product (real estate:
 * bookings are about a listing), or nothing but details.
 */
export type ProductAction = 'cart' | 'book' | 'none'

export function productAction(ws: Workspace): ProductAction {
  const { preset, modules } = resolveIndustry(ws.industry, ws.settings)
  if (modules.orders) return 'cart'
  if (modules.bookings && preset.bookingFields.some((f) => f.type === 'product')) return 'book'
  return 'none'
}

function primaryButton(action: ProductAction, productId: string, t: ReturnType<typeof texts>) {
  if (action === 'cart') return { id: `cart:add:${productId}`, title: t.buttons.add }
  if (action === 'book') return { id: `visit:book:${productId}`, title: t.buttons.bookVisit }
  return null
}

// ------------------------------------------------------------
// Product carousel
// ------------------------------------------------------------
export async function sendProductCarousel(ctx: CommerceCtx, productIds: string[], intro?: string): Promise<boolean> {
  const lang = langFor(ctx.workspace)
  const t = texts(lang)
  const { data } = await supabaseAdmin()
    .from('products')
    .select('id, name, price, currency, images, track_stock, stock, description')
    .eq('workspace_id', ctx.workspace.id)
    .eq('is_active', true)
    .in('id', productIds.filter((id) => UUID.test(id)).slice(0, 10))
  const byId = new Map((data ?? []).map((p) => [p.id, p]))
  const products = productIds.map((id) => byId.get(id)).filter((p): p is NonNullable<typeof p> => !!p && !!p.images?.[0])
  if (!products.length) return false

  const action = productAction(ctx.workspace)
  const cards: CarouselCard[] = products.map((p) => {
    const main = primaryButton(action, p.id, t)
    const moreTitle = action === 'book' ? t.buttons.details : t.buttons.more
    const soldOut = p.track_stock && (p.stock ?? 0) <= 0
    const price = p.price === null ? '' : formatProductPrice(Number(p.price), p, ctx.workspace)
    return {
      id: p.id,
      imageUrl: p.images[0],
      title: p.name,
      subtitle: [price, soldOut ? (lang === 'en' ? 'Out of stock' : 'Agotado') : ''].filter(Boolean).join(' · ') || undefined,
      buttons: main ? [main, { id: `cart:more:${p.id}`, title: moreTitle }] : [{ id: `cart:more:${p.id}`, title: moreTitle }],
    }
  })
  await say(ctx, { type: 'carousel', text: intro || (lang === 'en' ? 'Here you go:' : 'Mira estas opciones:'), cards }, { product_ids: products.map((p) => p.id) })
  return true
}

// ------------------------------------------------------------
// Cart summary
// ------------------------------------------------------------
export async function sendCartSummary(ctx: CommerceCtx, cart: Cart | null, intro?: string) {
  const lang = langFor(ctx.workspace)
  const t = texts(lang)
  const lines = cart ? await cartItems(cart.id) : []
  if (!cart || !lines.length) {
    await say(ctx, { type: 'text', text: t.cartEmpty })
    return
  }
  const settings = settingsFor(ctx.workspace)
  const totals = computeTotals(lines, settings, cart.checkout?.fulfillment)
  const summary = summaryText(lang, t.cartTitle, lines, totals, moneyFor(ctx.workspace))
  const text = intro ? `${intro}\n\n${summary}` : summary
  await say(
    ctx,
    {
      type: 'buttons',
      text,
      options: [
        { id: 'cart:checkout', title: t.buttons.checkout },
        { id: 'cart:shop', title: t.buttons.keepShopping },
        { id: 'cart:clear', title: t.buttons.clear },
      ],
    },
    { cart_id: cart.id, event: 'cart_summary' },
  )
}

// ------------------------------------------------------------
// Checkout steps
// ------------------------------------------------------------
async function nextCheckoutStep(ctx: CommerceCtx, cart: Cart) {
  const lang = langFor(ctx.workspace)
  const t = texts(lang)
  const settings = settingsFor(ctx.workspace)
  const lines = await cartItems(cart.id)
  if (!lines.length) return sendCartSummary(ctx, cart)

  const totals = computeTotals(lines, settings, cart.checkout.fulfillment)
  if (settings.minOrder && totals.subtotal < settings.minOrder) {
    const money = moneyFor(ctx.workspace)
    await say(ctx, { type: 'text', text: fill(t.minOrder, { amount: money(settings.minOrder), missing: money(settings.minOrder - totals.subtotal) }) })
    return
  }

  const co = cart.checkout ?? {}
  if (!co.fulfillment) {
    if (settings.fulfillment.length === 1) {
      await saveCheckout(cart, { fulfillment: settings.fulfillment[0] })
      return nextCheckoutStep(ctx, cart)
    }
    await saveCheckout(cart, { step: 'fulfillment' })
    await say(ctx, {
      type: 'buttons',
      text: t.askFulfillment,
      options: settings.fulfillment.slice(0, 3).map((f) => ({ id: `ful:${f}`, title: t.fulfillment[f] })),
    })
    return
  }
  if (co.fulfillment === 'delivery' && !co.address) {
    await saveCheckout(cart, { step: 'address' })
    await say(ctx, { type: 'text', text: t.askAddress })
    return
  }
  if (!co.customer_name) {
    const { data: c } = await supabaseAdmin().from('contacts').select('name').eq('id', ctx.contactId).maybeSingle()
    if (c?.name && !/^\+?\d+$/.test(c.name) && !/^(webchat|whatsapp|instagram|messenger|tiktok) /i.test(c.name)) {
      await saveCheckout(cart, { customer_name: c.name })
    } else {
      await saveCheckout(cart, { step: 'name' })
      await say(ctx, { type: 'text', text: t.askName })
      return
    }
  }

  // Review
  await saveCheckout(cart, { step: 'review' })
  const money = moneyFor(ctx.workspace)
  const finalTotals = computeTotals(lines, settings, cart.checkout.fulfillment)
  const extra = [
    `${lang === 'en' ? 'Delivery method' : 'Entrega'}: ${t.fulfillment[cart.checkout.fulfillment!]}`,
    cart.checkout.address ? `${lang === 'en' ? 'Address' : 'Dirección'}: ${cart.checkout.address}` : '',
    cart.checkout.customer_name ? `${lang === 'en' ? 'Name' : 'Nombre'}: ${cart.checkout.customer_name}` : '',
  ].filter(Boolean)
  const text = `${summaryText(lang, t.review, lines, finalTotals, money)}\n\n${extra.join('\n')}\n\n${t.confirmQuestion}`
  await say(ctx, {
    type: 'buttons',
    text,
    options: [
      { id: 'order:confirm', title: t.buttons.confirm },
      { id: 'order:edit', title: t.buttons.edit },
    ],
  })
}

/** Starts (or resumes) checkout for the conversation's open cart. */
export async function startCheckout(ctx: CommerceCtx) {
  const cart = await getOpenCart(ctx.workspace.id, ctx.conversationId, ctx.contactId, false)
  if (!cart) return sendCartSummary(ctx, null)
  return nextCheckoutStep(ctx, cart)
}

/**
 * Free text while a checkout step waits for an answer (address, name).
 * Returns true when the text was consumed.
 */
export async function handleCheckoutText(ctx: CommerceCtx, text: string): Promise<boolean> {
  const cart = await getOpenCart(ctx.workspace.id, ctx.conversationId, ctx.contactId, false)
  const step = cart?.checkout?.step
  const value = text.trim()
  if (!cart || !value || (step !== 'address' && step !== 'name')) return false
  if (step === 'address') {
    const [address, ...ref] = value.split(/\s+[—–-]\s+|\n/)
    await saveCheckout(cart, { address: address.trim().slice(0, 300), address_reference: ref.join(' ').trim().slice(0, 300) || undefined, step: undefined })
  } else {
    await saveCheckout(cart, { customer_name: value.slice(0, 120), step: undefined })
    await supabaseAdmin().from('contacts').update({ name: value.slice(0, 120) }).eq('id', ctx.contactId)
  }
  await nextCheckoutStep(ctx, cart)
  return true
}

// ------------------------------------------------------------
// Payment
// ------------------------------------------------------------
export async function sendPaymentOptions(ctx: CommerceCtx, orderId: string) {
  const lang = langFor(ctx.workspace)
  const t = texts(lang)
  const { data: methods } = await supabaseAdmin()
    .from('payment_methods')
    .select('id, name')
    .eq('workspace_id', ctx.workspace.id)
    .eq('is_active', true)
    .order('sort_order')
    .order('name')
  if (!methods?.length) return
  if (methods.length === 1) return sendPaymentMethod(ctx, orderId, methods[0].id)
  const options: InteractiveOption[] = methods.map((m) => ({ id: `pay:${m.id}`, title: m.name.slice(0, 24) }))
  await say(
    ctx,
    options.length <= 3
      ? { type: 'buttons', text: t.choosePayment, options }
      : { type: 'list', text: t.choosePayment, buttonLabel: t.buttons.payOptions, sections: [{ options: options.slice(0, 10) }] },
    { order_id: orderId, event: 'payment_options' },
  )
}

async function sendPaymentMethod(ctx: CommerceCtx, orderId: string | null, methodId: string) {
  const db = supabaseAdmin()
  const lang = langFor(ctx.workspace)
  const t = texts(lang)
  const { data: m } = await db
    .from('payment_methods')
    .select('id, name, instructions, qr_image_url, requires_proof')
    .eq('id', methodId)
    .eq('workspace_id', ctx.workspace.id)
    .maybeSingle()
  if (!m) return
  const order = orderId ? { id: orderId } : await latestUnpaidOrder(ctx)
  const caption = fill(t.paymentInstructions, { method: m.name, instructions: m.instructions ? `\n${m.instructions}` : '' })
  if (m.qr_image_url) await say(ctx, { type: 'media', mediaType: 'image', url: m.qr_image_url, caption }, { order_id: order?.id, event: 'payment_method' })
  else await say(ctx, { type: 'text', text: caption }, { order_id: order?.id, event: 'payment_method' })
  if (m.requires_proof) await say(ctx, { type: 'text', text: t.sendProof })
  if (order) {
    await db
      .from('orders')
      .update({ payment_method_id: m.id, payment_method_name: m.name, payment_status: m.requires_proof ? 'awaiting_proof' : 'unpaid' })
      .eq('id', order.id)
      .in('payment_status', ['unpaid', 'awaiting_proof'])
  }
}

async function latestUnpaidOrder(ctx: CommerceCtx) {
  const { data } = await supabaseAdmin()
    .from('orders')
    .select('id, number, payment_status')
    .eq('workspace_id', ctx.workspace.id)
    .eq('conversation_id', ctx.conversationId)
    .neq('status', 'cancelled')
    .in('payment_status', ['unpaid', 'awaiting_proof'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data
}

/**
 * An image from the customer while an order waits for its payment proof
 * becomes that proof. Returns true when it was taken as proof.
 */
export async function handlePaymentProof(ctx: CommerceCtx, mediaUrl: string): Promise<boolean> {
  const db = supabaseAdmin()
  const { data: order } = await db
    .from('orders')
    .select('id, number')
    .eq('workspace_id', ctx.workspace.id)
    .eq('conversation_id', ctx.conversationId)
    .eq('payment_status', 'awaiting_proof')
    .neq('status', 'cancelled')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!order) return false
  await db.from('orders').update({ payment_status: 'proof_received', payment_proof_url: mediaUrl }).eq('id', order.id)
  await db.from('order_events').insert({ workspace_id: ctx.workspace.id, order_id: order.id, type: 'payment', from_value: 'awaiting_proof', to_value: 'proof_received' })
  // Flag the conversation for the team: someone has to verify the payment.
  await db.from('conversations').update({ status: 'open', unread_count: 1 }).eq('id', ctx.conversationId)
  await say(ctx, { type: 'text', text: fill(texts(langFor(ctx.workspace)).proofReceived, { number: order.number }) }, { order_id: order.id, event: 'payment_proof' })
  return true
}

// ------------------------------------------------------------
// Placing the order
// ------------------------------------------------------------
export async function confirmFromChat(ctx: CommerceCtx, source: 'ai' | 'chat_buttons' | 'webchat') {
  const lang = langFor(ctx.workspace)
  const t = texts(lang)
  const cart = await getOpenCart(ctx.workspace.id, ctx.conversationId, ctx.contactId, false)
  if (!cart) return sendCartSummary(ctx, null)
  const settings = settingsFor(ctx.workspace)
  const result = await placeOrderFromCart({ workspace: ctx.workspace, cart, channelId: ctx.channel.id, source, aiAgentId: ctx.aiAgentId, settings })
  if (!result.ok) {
    if (result.reason === 'stock') await say(ctx, { type: 'text', text: fill(t.outOfStock, { name: result.detail ?? '' }) })
    else return nextCheckoutStep(ctx, cart)
    return
  }
  const money = moneyFor(ctx.workspace)
  await say(
    ctx,
    { type: 'text', text: fill(t.placed, { number: result.order.number, total: money(result.order.total), next: t.placedNextPending }) },
    { order_id: result.order.id, event: 'order_placed' },
  )
  // Team needs to act on it.
  await supabaseAdmin().from('conversations').update({ status: 'open' }).eq('id', ctx.conversationId)
  await sendPaymentOptions(ctx, result.order.id)
}

// ------------------------------------------------------------
// Button dispatcher
// ------------------------------------------------------------
export async function handleCommerceAction(ctx: CommerceCtx, id: string): Promise<boolean> {
  const lang: Lang = langFor(ctx.workspace)
  const t = texts(lang)
  const [kind, action, a, b] = id.split(':')

  if (kind === 'cart') {
    if (action === 'add' && a && UUID.test(a)) {
      if (!ordersEnabled(ctx.workspace)) return false
      // Priced in another currency (e.g. a USD listing): quoted by a person, not via cart.
      const { data: prod } = await supabaseAdmin().from('products').select('name, currency').eq('id', a).eq('workspace_id', ctx.workspace.id).maybeSingle()
      const foreign = prod ? cartCurrencyConflict(prod, ctx.workspace.currency) : null
      if (prod && foreign) {
        await say(ctx, { type: 'text', text: fill(t.foreignCurrency, { name: prod.name, currency: foreign }) })
        return true
      }
      // Products with variants: ask which one first.
      const { data: variants } = await supabaseAdmin()
        .from('product_variants')
        .select('id, name, price')
        .eq('product_id', a)
        .eq('is_active', true)
        .order('sort_order')
      if (!b && variants && variants.length > 0) {
        const money = moneyFor(ctx.workspace)
        const options = variants.map((v) => ({ id: `cart:add:${a}:${v.id}`, title: v.name.slice(0, 24), description: v.price !== null ? money(Number(v.price)) : undefined }))
        await say(
          ctx,
          options.length <= 3
            ? { type: 'buttons', text: lang === 'en' ? 'Which one?' : '¿Cuál prefieres?', options }
            : { type: 'list', text: lang === 'en' ? 'Which one?' : '¿Cuál prefieres?', buttonLabel: lang === 'en' ? 'Options' : 'Opciones', sections: [{ options: options.slice(0, 10) }] },
        )
        return true
      }
      const cart = await getOpenCart(ctx.workspace.id, ctx.conversationId, ctx.contactId, true)
      const r = await addToCart(cart!, a, b && UUID.test(b) ? b : null, 1)
      if (!r.ok) {
        const msg =
          r.reason === 'foreign_currency'
            ? fill(t.foreignCurrency, { name: r.name, currency: r.currency })
            : r.reason === 'price_on_request'
            ? fill(t.priceOnRequest, { name: r.name ?? '' })
            : r.reason === 'out_of_stock'
              ? fill(t.outOfStock, { name: r.name ?? '' })
              : r.reason === 'not_enough'
                ? fill(t.notEnough, { name: r.name ?? '', available: r.available ?? 0 })
                : t.unavailable
        await say(ctx, { type: 'text', text: msg })
        return true
      }
      await say(ctx, {
        type: 'buttons',
        text: fill(t.added, { qty: r.quantity, name: r.name }),
        options: [
          { id: 'cart:view', title: t.buttons.viewCart },
          { id: 'cart:checkout', title: t.buttons.checkout },
          { id: 'cart:shop', title: t.buttons.keepShopping },
        ],
      })
      return true
    }
    if (action === 'more' && a && UUID.test(a)) {
      const { data: p } = await supabaseAdmin()
        .from('products')
        .select('name, description, price, currency, images')
        .eq('id', a)
        .eq('workspace_id', ctx.workspace.id)
        .maybeSingle()
      if (!p) return false
      const action = productAction(ctx.workspace)
      // Real estate: link to the public property page (gallery, map, PDF).
      const link = action === 'book' ? propertyUrl(ctx.workspace, { id: a }) : ''
      const text = [`*${p.name}*${p.price !== null ? ` — ${formatProductPrice(Number(p.price), p, ctx.workspace)}` : ''}`, p.description ?? '', link ? `${lang === 'en' ? 'Full details' : 'Ficha completa'}: ${link}` : '']
        .filter(Boolean)
        .join('\n\n')
      const content: OutboundContent =
        action === 'cart' && !cartCurrencyConflict(p, ctx.workspace.currency)
          ? { type: 'buttons', text: text.slice(0, 1000), options: [{ id: `cart:add:${a}`, title: t.buttons.add }, { id: 'cart:view', title: t.buttons.viewCart }] }
          : action === 'book'
            ? { type: 'buttons', text: text.slice(0, 1000), options: [{ id: `visit:book:${a}`, title: t.buttons.bookVisit }] }
            : { type: 'text', text }
      await say(ctx, content, { product_id: a })
      return true
    }
    if (action === 'view') {
      await sendCartSummary(ctx, await getOpenCart(ctx.workspace.id, ctx.conversationId, ctx.contactId, false))
      return true
    }
    if (action === 'clear') {
      const cart = await getOpenCart(ctx.workspace.id, ctx.conversationId, ctx.contactId, false)
      if (cart) await clearCart(cart)
      await say(ctx, { type: 'text', text: t.cleared })
      return true
    }
    if (action === 'checkout') {
      await startCheckout(ctx)
      return true
    }
    if (action === 'shop') {
      // Featured / first products as a carousel; the agent takes it from there.
      const { data } = await supabaseAdmin()
        .from('products')
        .select('id')
        .eq('workspace_id', ctx.workspace.id)
        .eq('is_active', true)
        .neq('images', '{}')
        .order('is_featured', { ascending: false })
        .order('sort_order')
        .limit(10)
      const ok = await sendProductCarousel(ctx, (data ?? []).map((p) => p.id))
      if (!ok) await say(ctx, { type: 'text', text: lang === 'en' ? 'What are you looking for?' : '¿Qué estás buscando?' })
      return true
    }
    return false
  }

  if (kind === 'ful' && ['pickup', 'delivery', 'dine_in'].includes(action)) {
    const cart = await getOpenCart(ctx.workspace.id, ctx.conversationId, ctx.contactId, false)
    if (!cart) return false
    await saveCheckout(cart, { fulfillment: action as Fulfillment, step: undefined })
    await nextCheckoutStep(ctx, cart)
    return true
  }

  if (kind === 'order') {
    if (action === 'confirm') {
      await confirmFromChat(ctx, ctx.channel.type === 'webchat' ? 'webchat' : 'chat_buttons')
      return true
    }
    if (action === 'edit') {
      const cart = await getOpenCart(ctx.workspace.id, ctx.conversationId, ctx.contactId, false)
      if (cart) await saveCheckout(cart, { step: undefined, fulfillment: undefined, address: undefined })
      await sendCartSummary(ctx, cart)
      return true
    }
    return false
  }

  if (kind === 'pay' && action && UUID.test(action)) {
    await sendPaymentMethod(ctx, null, action)
    return true
  }
  return false
}

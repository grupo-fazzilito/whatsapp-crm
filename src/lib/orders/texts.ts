// Customer-facing texts for carts, checkout, payments and order status.
// Plain functions (no server deps) so they can be unit-tested.

export type Lang = 'es' | 'en'
export type Fulfillment = 'pickup' | 'delivery' | 'dine_in'
export type OrderStatus = 'pending' | 'confirmed' | 'preparing' | 'ready' | 'shipped' | 'delivered' | 'cancelled'

const T = {
  es: {
    added: '✅ Agregué *{qty}× {name}* a tu carrito.',
    removed: 'Quité *{name}* de tu carrito.',
    cleared: 'Vacié tu carrito.',
    priceOnRequest: '*{name}* tiene precio a consultar; te comunico con el equipo para cotizarlo.',
    outOfStock: 'Lo siento, *{name}* está agotado por ahora.',
    notEnough: 'Solo nos quedan {available} de *{name}*.',
    unavailable: 'Ese producto ya no está disponible.',
    cartTitle: '🛒 *Tu carrito*',
    cartEmpty: 'Tu carrito está vacío. ¿Te muestro lo que tenemos?',
    subtotal: 'Subtotal',
    delivery: 'Delivery',
    total: '*Total*',
    minOrder: 'El pedido mínimo es {amount}. Te faltan {missing}.',
    askFulfillment: '¿Cómo quieres recibir tu pedido?',
    askAddress: '📍 Envíame la *dirección de entrega* y una referencia (por ejemplo: "Av. Larco 123, dpto 402 — frente al parque").',
    askName: '¿A nombre de quién hacemos el pedido?',
    review: '🧾 *Revisa tu pedido*',
    confirmQuestion: '¿Confirmo el pedido?',
    placed: '🧾 ¡Recibimos tu pedido *#{number}*! Total: *{total}*.\n{next}',
    placedNextPending: 'Te avisaremos apenas lo confirmemos.',
    choosePayment: '💳 ¿Cómo deseas pagar?',
    paymentInstructions: '*{method}*{instructions}',
    sendProof: 'Cuando pagues, envíame aquí la *captura del pago* para verificarlo. 🙌',
    proofReceived: '¡Gracias! 🙌 Recibimos tu comprobante del pedido *#{number}*. Lo verificamos y te confirmamos.',
    paid: '✅ Confirmamos el pago de tu pedido *#{number}*. ¡Gracias!',
    noOpenOrder: 'No encontré un pedido pendiente de pago.',
    status: {
      confirmed: '✅ Tu pedido *#{number}* fue confirmado.',
      preparing: '👨‍🍳 Estamos preparando tu pedido *#{number}*.',
      ready_pickup: '🛍️ Tu pedido *#{number}* está listo para recoger.',
      ready_dine_in: '🍽️ Tu pedido *#{number}* está listo.',
      ready_delivery: '📦 Tu pedido *#{number}* está listo y saldrá pronto.',
      shipped: '🛵 Tu pedido *#{number}* va en camino.',
      delivered: '🎉 Tu pedido *#{number}* fue entregado. ¡Gracias por tu compra!',
      cancelled: 'Tu pedido *#{number}* fue cancelado.{reason}',
    } as Record<string, string>,
    fulfillment: { pickup: 'Recojo en tienda', delivery: 'Delivery', dine_in: 'Consumo en el local' } as Record<Fulfillment, string>,
    buttons: {
      add: 'Agregar',
      more: 'Ver más',
      viewCart: 'Ver carrito',
      checkout: 'Finalizar pedido',
      keepShopping: 'Seguir comprando',
      clear: 'Vaciar carrito',
      confirm: 'Confirmar pedido',
      edit: 'Modificar',
      payOptions: 'Ver opciones',
    },
  },
  en: {
    added: '✅ Added *{qty}× {name}* to your cart.',
    removed: 'Removed *{name}* from your cart.',
    cleared: 'Your cart is now empty.',
    priceOnRequest: '*{name}* is priced on request; I’ll connect you with the team for a quote.',
    outOfStock: 'Sorry, *{name}* is out of stock right now.',
    notEnough: 'We only have {available} of *{name}* left.',
    unavailable: 'That product is no longer available.',
    cartTitle: '🛒 *Your cart*',
    cartEmpty: 'Your cart is empty. Want to see what we have?',
    subtotal: 'Subtotal',
    delivery: 'Delivery',
    total: '*Total*',
    minOrder: 'The minimum order is {amount}. You’re {missing} short.',
    askFulfillment: 'How would you like to get your order?',
    askAddress: '📍 Send me the *delivery address* and a reference (e.g. "123 Main St, apt 4 — next to the park").',
    askName: 'What name should the order be under?',
    review: '🧾 *Review your order*',
    confirmQuestion: 'Shall I place the order?',
    placed: '🧾 We got your order *#{number}*! Total: *{total}*.\n{next}',
    placedNextPending: 'We’ll let you know as soon as it’s confirmed.',
    choosePayment: '💳 How would you like to pay?',
    paymentInstructions: '*{method}*{instructions}',
    sendProof: 'Once you pay, send me a *screenshot of the payment* here so we can verify it. 🙌',
    proofReceived: 'Thanks! 🙌 We received your payment proof for order *#{number}*. We’ll verify it and confirm.',
    paid: '✅ We confirmed the payment for order *#{number}*. Thank you!',
    noOpenOrder: 'I couldn’t find an order waiting for payment.',
    status: {
      confirmed: '✅ Your order *#{number}* is confirmed.',
      preparing: '👨‍🍳 We’re preparing your order *#{number}*.',
      ready_pickup: '🛍️ Your order *#{number}* is ready for pickup.',
      ready_dine_in: '🍽️ Your order *#{number}* is ready.',
      ready_delivery: '📦 Your order *#{number}* is ready and will leave soon.',
      shipped: '🛵 Your order *#{number}* is on its way.',
      delivered: '🎉 Your order *#{number}* was delivered. Thanks for your purchase!',
      cancelled: 'Your order *#{number}* was cancelled.{reason}',
    } as Record<string, string>,
    fulfillment: { pickup: 'Store pickup', delivery: 'Delivery', dine_in: 'Dine in' } as Record<Fulfillment, string>,
    buttons: {
      add: 'Add',
      more: 'More info',
      viewCart: 'View cart',
      checkout: 'Checkout',
      keepShopping: 'Keep shopping',
      clear: 'Empty cart',
      confirm: 'Place order',
      edit: 'Change',
      payOptions: 'See options',
    },
  },
} as const

export function texts(lang: Lang) {
  return T[lang]
}

export function fill(s: string, vars: Record<string, string | number>): string {
  return s.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : ''))
}

export interface CartLine {
  name: string
  quantity: number
  unitPrice: number
}

/** Cart / order summary lines with totals. `money` formats an amount. */
export function summaryText(
  lang: Lang,
  title: string,
  lines: CartLine[],
  totals: { subtotal: number; deliveryFee: number; total: number },
  money: (n: number) => string,
): string {
  const t = T[lang]
  const body = lines.map((l) => `• ${l.quantity}× ${l.name} — ${money(l.unitPrice * l.quantity)}`)
  const footer = [`${t.subtotal}: ${money(totals.subtotal)}`]
  if (totals.deliveryFee > 0) footer.push(`${t.delivery}: ${money(totals.deliveryFee)}`)
  footer.push(`${t.total}: *${money(totals.total)}*`)
  return [title, '', ...body, '', ...footer].join('\n')
}

export function statusMessage(lang: Lang, status: OrderStatus, fulfillment: Fulfillment, number: number, reason?: string | null): string | null {
  const t = T[lang]
  if (status === 'pending') return null
  const key = status === 'ready' ? `ready_${fulfillment}` : status
  const tpl = t.status[key]
  if (!tpl) return null
  return fill(tpl, { number, reason: reason ? ` ${reason}` : '' })
}

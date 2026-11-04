// Checkout form of the online store: what the browser sends. Pure, so the
// form and the server validate the same way.

export interface CheckoutItem {
  product_id: string
  variant_id: string | null
  quantity: number
}

export interface CheckoutAddress {
  department: string
  province: string
  district: string
  line: string
  reference: string | null
}

export interface CheckoutInput {
  items: CheckoutItem[]
  customer: { name: string; phone: string; email: string | null; document: string | null }
  fulfillment: 'delivery' | 'pickup'
  shipping_profile_id: string | null
  address: CheckoutAddress | null
  payment_method_id: string
  notes: string | null
}

export type CheckoutError =
  | 'items'
  | 'name'
  | 'phone'
  | 'email'
  | 'document'
  | 'fulfillment'
  | 'shipping'
  | 'address'
  | 'payment'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const MAX_LINES = 50
export const MAX_QUANTITY = 99

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '')

/** Phone as typed → digits with country code ("987 654 321" + PE → "51987654321"). */
export function checkoutPhone(raw: string, dialCode: string): string | null {
  const trimmed = raw.trim()
  const digits = trimmed.replace(/\D/g, '')
  if (!digits) return null
  const dial = dialCode.replace(/\D/g, '')
  // "+51…" or "0051…": already international.
  const full = trimmed.startsWith('+') ? digits : digits.startsWith('00') ? digits.slice(2) : digits.startsWith(dial) && digits.length > 9 ? digits : dial + digits.replace(/^0+/, '')
  return /^[1-9]\d{7,14}$/.test(full) ? full : null
}

/** Merges repeated lines and validates quantities. */
export function parseItems(raw: unknown): CheckoutItem[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_LINES) return null
  const byKey = new Map<string, CheckoutItem>()
  for (const r of raw as Record<string, unknown>[]) {
    const product_id = typeof r?.product_id === 'string' ? r.product_id : ''
    const variant_id = typeof r?.variant_id === 'string' && r.variant_id ? r.variant_id : null
    const quantity = Number(r?.quantity)
    if (!UUID.test(product_id) || (variant_id && !UUID.test(variant_id)) || !Number.isInteger(quantity) || quantity < 1) return null
    const key = `${product_id}:${variant_id ?? ''}`
    const prev = byKey.get(key)
    byKey.set(key, { product_id, variant_id, quantity: Math.min(MAX_QUANTITY, (prev?.quantity ?? 0) + quantity) })
  }
  return [...byKey.values()]
}

export function parseCheckoutInput(body: Record<string, unknown> | null, dialCode: string): { ok: true; input: CheckoutInput } | { ok: false; error: CheckoutError } {
  if (!body) return { ok: false, error: 'items' }
  const items = parseItems(body.items)
  if (!items) return { ok: false, error: 'items' }

  const c = (body.customer ?? {}) as Record<string, unknown>
  const name = text(c.name, 120)
  if (name.length < 2) return { ok: false, error: 'name' }
  const phone = checkoutPhone(typeof c.phone === 'string' ? c.phone : '', dialCode)
  if (!phone) return { ok: false, error: 'phone' }
  const emailRaw = text(c.email, 160).toLowerCase()
  if (emailRaw && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(emailRaw)) return { ok: false, error: 'email' }
  const docRaw = text(c.document, 20).replace(/\s/g, '')
  if (docRaw && !/^[A-Za-z0-9-]{6,20}$/.test(docRaw)) return { ok: false, error: 'document' }

  const fulfillment = body.fulfillment
  if (fulfillment !== 'delivery' && fulfillment !== 'pickup') return { ok: false, error: 'fulfillment' }

  let shipping_profile_id: string | null = null
  let address: CheckoutAddress | null = null
  if (fulfillment === 'delivery') {
    shipping_profile_id = typeof body.shipping_profile_id === 'string' && UUID.test(body.shipping_profile_id) ? body.shipping_profile_id : null
    if (!shipping_profile_id) return { ok: false, error: 'shipping' }
    const a = (body.address ?? {}) as Record<string, unknown>
    address = {
      department: text(a.department, 80),
      province: text(a.province, 80),
      district: text(a.district, 80),
      line: text(a.line, 200),
      reference: text(a.reference, 200) || null,
    }
    if (!address.department || !address.district || address.line.length < 4) return { ok: false, error: 'address' }
  }

  const payment_method_id = typeof body.payment_method_id === 'string' && UUID.test(body.payment_method_id) ? body.payment_method_id : ''
  if (!payment_method_id) return { ok: false, error: 'payment' }

  return {
    ok: true,
    input: {
      items,
      customer: { name, phone, email: emailRaw || null, document: docRaw || null },
      fulfillment,
      shipping_profile_id,
      address,
      payment_method_id,
      notes: text(body.notes, 500) || null,
    },
  }
}

/** One line of the address for the order and messages. */
export function addressLine(a: CheckoutAddress): string {
  return [a.line, a.district, a.province, a.department].filter(Boolean).join(', ')
}

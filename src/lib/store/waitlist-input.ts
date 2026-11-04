// "Notify me when available" form of the public store. Pure.
import { isUuid } from '@/lib/workspace/constants'
import { checkoutPhone } from './checkout'
import { fill, storeTexts } from './texts'

export interface WaitlistInput {
  product_id: string
  variant_id: string | null
  name: string | null
  /** Digits with country code. */
  phone: string
}

export type WaitlistParse = { ok: true; input: WaitlistInput } | { ok: false; error: 'product' | 'phone' }

export function parseWaitlistInput(body: unknown, dialCode: string): WaitlistParse {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  if (typeof b.product_id !== 'string' || !isUuid(b.product_id)) return { ok: false, error: 'product' }
  if (b.variant_id != null && (typeof b.variant_id !== 'string' || !isUuid(b.variant_id))) return { ok: false, error: 'product' }
  const phone = typeof b.phone === 'string' ? checkoutPhone(b.phone, dialCode) : null
  if (!phone) return { ok: false, error: 'phone' }
  const name = typeof b.name === 'string' ? b.name.replace(/\s+/g, ' ').trim().slice(0, 80) : ''
  return { ok: true, input: { product_id: b.product_id, variant_id: (b.variant_id as string | null) ?? null, name: name || null, phone } }
}

/** "Polo (Talla M)" */
export const waitlistItemName = (product: string, variant: string | null) => (variant ? `${product} (${variant})` : product)

/** wa.me link with the customer's message to the business. */
export function waitlistWhatsAppUrl(storeWhatsApp: string, locale: string, item: string, name: string | null, productUrl: string): string {
  const t = storeTexts(locale).notify
  const text = fill(name ? t.waMessageNamed : t.waMessage, { name: name ?? '', product: `«${item}»`, url: productUrl }).trim()
  return `https://wa.me/${storeWhatsApp}?text=${encodeURIComponent(text)}`
}

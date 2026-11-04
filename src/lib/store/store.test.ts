import { describe, expect, it } from 'vitest'
import { orderWeight, parseShippingInput, quoteShipping } from './shipping'
import { addressLine, checkoutPhone, parseCheckoutInput, parseItems } from './checkout'
import { missingForStore, orderFees, parseFees, storeSettings } from './settings'

const P = '11111111-2222-4333-8444-555555555555'
const V = '66666666-7777-4888-9999-000000000000'
const S = '22222222-3333-4444-8555-666666666666'
const M = '33333333-4444-4555-8666-777777777777'

describe('shipping profiles', () => {
  it('validates the three types', () => {
    expect(parseShippingInput({ name: 'Gratis', type: 'free', flat_price: 9, free_over: 5 })).toMatchObject({ ok: true, profile: { type: 'free', flat_price: null, free_over: null } })
    expect(parseShippingInput({ name: 'Lima', type: 'flat', flat_price: '15' })).toMatchObject({ ok: true, profile: { flat_price: 15 } })
    expect(parseShippingInput({ name: 'Lima', type: 'flat' })).toEqual({ ok: false, error: 'flat_price' })
    expect(parseShippingInput({ name: '', type: 'flat', flat_price: 1 })).toEqual({ ok: false, error: 'name' })
    const w = parseShippingInput({ name: 'Provincias', type: 'weight', rates: [{ up_to_kg: 1, price: 10 }, { up_to_kg: '5', price: 18 }, { up_to_kg: null, price: 30 }], free_over: 300 })
    expect(w).toMatchObject({ ok: true, profile: { rates: [{ up_to_kg: 1, price: 10 }, { up_to_kg: 5, price: 18 }, { up_to_kg: null, price: 30 }], free_over: 300 } })
  })

  it('rejects unordered or open-in-the-middle ranges', () => {
    expect(parseShippingInput({ name: 'x', type: 'weight', rates: [{ up_to_kg: 5, price: 1 }, { up_to_kg: 2, price: 2 }] })).toEqual({ ok: false, error: 'rate_order' })
    expect(parseShippingInput({ name: 'x', type: 'weight', rates: [{ up_to_kg: null, price: 1 }, { up_to_kg: 2, price: 2 }] })).toEqual({ ok: false, error: 'rate_order' })
    expect(parseShippingInput({ name: 'x', type: 'weight', rates: [] })).toEqual({ ok: false, error: 'rates' })
  })

  it('quotes by type, weight range and free-over amount', () => {
    const weight = { type: 'weight' as const, flat_price: null, free_over: 300, rates: [{ up_to_kg: 1, price: 10 }, { up_to_kg: 5, price: 18 }] }
    expect(quoteShipping(weight, 100, 0.8)).toEqual({ ok: true, fee: 10, freeReason: null })
    expect(quoteShipping(weight, 100, 1)).toEqual({ ok: true, fee: 10, freeReason: null })
    expect(quoteShipping(weight, 100, 3.2)).toEqual({ ok: true, fee: 18, freeReason: null })
    expect(quoteShipping(weight, 100, 7)).toEqual({ ok: false, reason: 'too_heavy' })
    expect(quoteShipping(weight, 300, 3)).toEqual({ ok: true, fee: 0, freeReason: 'free_over' })
    expect(quoteShipping({ type: 'flat', flat_price: 15, free_over: null, rates: [] }, 999, 99)).toEqual({ ok: true, fee: 15, freeReason: null })
    expect(quoteShipping({ type: 'free', flat_price: null, free_over: null, rates: [] }, 1, 1)).toEqual({ ok: true, fee: 0, freeReason: 'profile' })
    expect(orderWeight([{ weightKg: 0.25, quantity: 3 }, { weightKg: null, quantity: 2 }])).toBe(0.75)
  })
})

describe('checkout input', () => {
  const base = {
    items: [{ product_id: P, quantity: 1 }, { product_id: P, quantity: 2 }, { product_id: P, variant_id: V, quantity: 1 }],
    customer: { name: ' Ana  Pérez ', phone: '987 654 321', email: 'ANA@mail.com', document: '' },
    fulfillment: 'delivery',
    shipping_profile_id: S,
    address: { department: 'Lima', province: 'Lima', district: 'Miraflores', line: 'Av. Larco 123', reference: '' },
    payment_method_id: M,
  }

  it('normalizes the customer, merges lines and keeps the address', () => {
    const r = parseCheckoutInput(base, '+51')
    expect(r).toMatchObject({
      ok: true,
      input: {
        items: [{ product_id: P, variant_id: null, quantity: 3 }, { product_id: P, variant_id: V, quantity: 1 }],
        customer: { name: 'Ana Pérez', phone: '51987654321', email: 'ana@mail.com', document: null },
        address: { district: 'Miraflores', reference: null },
      },
    })
    if (r.ok) expect(addressLine(r.input.address!)).toBe('Av. Larco 123, Miraflores, Lima, Lima')
  })

  it('reports the first wrong field', () => {
    expect(parseCheckoutInput({ ...base, items: [] }, '+51')).toEqual({ ok: false, error: 'items' })
    expect(parseCheckoutInput({ ...base, customer: { ...base.customer, phone: '12' } }, '+51')).toEqual({ ok: false, error: 'phone' })
    expect(parseCheckoutInput({ ...base, customer: { ...base.customer, email: 'nope' } }, '+51')).toEqual({ ok: false, error: 'email' })
    expect(parseCheckoutInput({ ...base, shipping_profile_id: null }, '+51')).toEqual({ ok: false, error: 'shipping' })
    expect(parseCheckoutInput({ ...base, address: { department: 'Lima' } }, '+51')).toEqual({ ok: false, error: 'address' })
    expect(parseCheckoutInput({ ...base, payment_method_id: 'x' }, '+51')).toEqual({ ok: false, error: 'payment' })
    // Pickup needs neither profile nor address.
    expect(parseCheckoutInput({ ...base, fulfillment: 'pickup', shipping_profile_id: null, address: null }, '+51')).toMatchObject({ ok: true, input: { address: null } })
  })

  it('reads phones in local and international form', () => {
    expect(checkoutPhone('+51 987-654-321', '+51')).toBe('51987654321')
    expect(checkoutPhone('51987654321', '+51')).toBe('51987654321')
    expect(checkoutPhone('0034 612 345 678', '+51')).toBe('34612345678')
    expect(checkoutPhone('abc', '+51')).toBeNull()
    expect(parseItems([{ product_id: P, quantity: 0 }])).toBeNull()
  })
})

describe('store settings', () => {
  it('fills defaults and lists what blocks publishing', () => {
    expect(storeSettings({ accent: 'red', whatsapp: '+51 987 654 321', enabled: true })).toMatchObject({ enabled: true, accent: '#059669', whatsapp: '51987654321' })
    expect(missingForStore({ ordersModule: true, shipping: false, payment: true, products: false })).toEqual(['shipping', 'products'])
  })
})

describe('shipping paid at destination and extra charges', () => {
  it('charges nothing for on-delivery shipping and drops its prices', () => {
    expect(parseShippingInput({ name: 'Shalom', type: 'on_delivery', flat_price: 9, free_over: 50 })).toMatchObject({ ok: true, profile: { type: 'on_delivery', flat_price: null, free_over: null, rates: [] } })
    expect(quoteShipping({ type: 'on_delivery', flat_price: null, free_over: null, rates: [] }, 100, 50)).toEqual({ ok: true, fee: 0, freeReason: null, onDelivery: true })
  })

  it('keeps valid charges and adds the required plus the picked ones', () => {
    const fees = parseFees([
      { id: 'pack', name: ' Empaquetado ', amount: '3', required: true },
      { id: 'gift', name: 'Envoltura de regalo', amount: 5.5, required: false },
      { id: 'bad', name: '', amount: 2 },
      { id: 'zero', name: 'Cero', amount: 0 },
    ])
    expect(fees).toEqual([
      { id: 'pack', name: 'Empaquetado', amount: 3, required: true },
      { id: 'gift', name: 'Envoltura de regalo', amount: 5.5, required: false },
    ])
    expect(orderFees(fees, [], 'delivery')).toEqual({ lines: [{ name: 'Empaquetado', amount: 3 }], total: 3 })
    expect(orderFees(fees, ['gift', 'nope'], 'delivery')).toEqual({ lines: [{ name: 'Empaquetado', amount: 3 }, { name: 'Envoltura de regalo', amount: 5.5 }], total: 8.5 })
    // Store pickup pays no extra charges.
    expect(orderFees(fees, ['gift'], 'pickup')).toEqual({ lines: [], total: 0 })
    expect(storeSettings({ fees }).fees).toHaveLength(2)
  })
})

describe('service checkout', () => {
  it('needs day and time only when the service books at checkout', async () => {
    const { parseServiceCheckout } = await import('./service-checkout')
    const body = { service_id: P, customer: { name: 'Luis Rojas', phone: '912 345 678' }, fields: { party_size: 4, reason: ' Dolor ', 'bad key': 'x' } }
    expect(parseServiceCheckout(body, '+51', true)).toEqual({ ok: false, error: 'slot' })
    const later = parseServiceCheckout(body, '+51', false)
    expect(later).toMatchObject({ ok: true, input: { date: null, time: null, customer: { phone: '51912345678' }, fields: { party_size: 4, reason: 'Dolor' } } })
    if (later.ok) expect(Object.keys(later.input.fields)).not.toContain('bad key')
    expect(parseServiceCheckout({ ...body, date: '2026-11-10', time: '10:30' }, '+51', true)).toMatchObject({ ok: true, input: { date: '2026-11-10', time: '10:30' } })
    expect(parseServiceCheckout({ ...body, service_id: 'x' }, '+51', false)).toEqual({ ok: false, error: 'service' })
  })

  it('pays now with a proof or at the business', async () => {
    const { parseServiceCheckout, isPayNowMethod, proofImageType, PAY_ON_SITE } = await import('./service-checkout')
    const body = { service_id: P, customer: { name: 'Luis Rojas', phone: '912345678' } }
    expect(parseServiceCheckout({ ...body, payment_method_id: PAY_ON_SITE }, '+51', false)).toMatchObject({ ok: true, input: { pay_on_site: true, payment_method_id: null } })
    expect(parseServiceCheckout({ ...body, payment_method_id: P }, '+51', false)).toMatchObject({ ok: true, input: { pay_on_site: false, payment_method_id: P } })
    expect(['qr', 'bank_transfer', 'cash', 'card_on_delivery', 'other'].filter(isPayNowMethod)).toEqual(['qr', 'bank_transfer'])
    const pad = (head: number[]) => new Uint8Array([...head, ...new Array(12).fill(0)])
    expect(proofImageType(pad([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg')
    expect(proofImageType(pad([0x89, 0x50, 0x4e, 0x47]))).toBe('image/png')
    expect(proofImageType(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp')
    expect(proofImageType(new TextEncoder().encode('%PDF-1.7 not an image'))).toBeNull()
    expect(proofImageType(new TextEncoder().encode('<svg onload=alert(1)>'))).toBeNull()
  })
})

describe('stock display and waitlist', () => {
  it('uses the product rule over the store rule', async () => {
    const { productStockRules } = await import('./stock-display')
    const store = { display: 'low' as const, threshold: 5, waitlist: true }
    expect(productStockRules(store, { stock_display: null, low_stock_threshold: null, waitlist_enabled: null })).toEqual(store)
    expect(productStockRules(store, { stock_display: 'exact', low_stock_threshold: 3, waitlist_enabled: false })).toEqual({ display: 'exact', threshold: 3, waitlist: false })
    expect(productStockRules(store, { stock_display: 'nope', low_stock_threshold: 0, waitlist_enabled: null })).toEqual(store)
    expect(storeSettings({})).toMatchObject({ stock_display: 'low', low_stock_threshold: 5, waitlist_enabled: true })
    expect(storeSettings({ stock_display: 'hidden', low_stock_threshold: '8', waitlist_enabled: false })).toMatchObject({ stock_display: 'hidden', low_stock_threshold: 8, waitlist_enabled: false })
  })

  it('shows the label and only tells the real amount when the store shows it', async () => {
    const { stockLabel, publicAvailable } = await import('./stock-display')
    const low = { display: 'low' as const, threshold: 5, waitlist: true }
    const exact = { ...low, display: 'exact' as const }
    const hidden = { ...low, display: 'hidden' as const }
    expect(stockLabel(low, 4)).toEqual({ kind: 'low' })
    expect(stockLabel(low, 5)).toBeNull()
    expect(stockLabel(low, 0)).toBeNull()
    expect(stockLabel(exact, 12)).toEqual({ kind: 'exact', n: 12, low: false })
    expect(stockLabel(exact, 2)).toEqual({ kind: 'exact', n: 2, low: true })
    expect(stockLabel(hidden, 1)).toBeNull()
    expect(stockLabel(exact, null)).toBeNull()
    expect([publicAvailable(exact, 7), publicAvailable(low, 3), publicAvailable(hidden, 3), publicAvailable(hidden, 0), publicAvailable(low, null)]).toEqual([7, null, null, 0, null])
  })

  it('reads the notify-me form and builds the WhatsApp message', async () => {
    const { parseWaitlistInput, waitlistWhatsAppUrl, waitlistItemName } = await import('./waitlist-input')
    expect(parseWaitlistInput({ product_id: P, phone: '987 654 321', name: '  Ana   Pérez ' }, '+51')).toEqual({ ok: true, input: { product_id: P, variant_id: null, name: 'Ana Pérez', phone: '51987654321' } })
    expect(parseWaitlistInput({ product_id: P, variant_id: V, phone: '+51987654321' }, '+51')).toMatchObject({ ok: true, input: { variant_id: V, name: null } })
    expect(parseWaitlistInput({ product_id: P, phone: '12' }, '+51')).toEqual({ ok: false, error: 'phone' })
    expect(parseWaitlistInput({ product_id: 'x', phone: '987654321' }, '+51')).toEqual({ ok: false, error: 'product' })
    expect(parseWaitlistInput({ product_id: P, variant_id: 'x', phone: '987654321' }, '+51')).toEqual({ ok: false, error: 'product' })
    const url = waitlistWhatsAppUrl('51911222333', 'es', waitlistItemName('Polo', 'Talla M'), 'Ana', 'https://x.com/p')
    expect(url.startsWith('https://wa.me/51911222333?text=')).toBe(true)
    expect(decodeURIComponent(url.split('text=')[1])).toBe('Hola, soy Ana. Quiero que me avisen cuando haya stock de «Polo (Talla M)». https://x.com/p')
  })
})

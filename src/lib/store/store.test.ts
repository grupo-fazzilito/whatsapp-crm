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

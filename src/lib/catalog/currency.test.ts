import { describe, expect, it } from 'vitest'
import { cartCurrencyConflict, effectiveCurrency, formatProductPrice, isForeignCurrency, parseCurrency, PRODUCT_CURRENCIES } from './currency'
import { guessMapping, normalizeRow, productPayload } from './import'

const pe = { currency: 'PEN', locale: 'es', country: 'PE' }
// Intl may use a no-break space after the symbol.
const sp = (s: string) => s.replace(/\s/g, ' ')

describe('effective product currency', () => {
  it('falls back to the workspace currency', () => {
    expect(effectiveCurrency({ currency: null }, 'PEN')).toBe('PEN')
    expect(effectiveCurrency({}, 'PEN')).toBe('PEN')
    expect(effectiveCurrency({ currency: 'USD' }, 'PEN')).toBe('USD')
    expect(isForeignCurrency({ currency: 'USD' }, 'PEN')).toBe(true)
    expect(isForeignCurrency({ currency: 'PEN' }, 'PEN')).toBe(false)
    expect(isForeignCurrency(null, 'PEN')).toBe(false)
  })

  it('formats with the product currency and the workspace locale', () => {
    expect(sp(formatProductPrice(350000, { currency: 'USD' }, pe))).toBe('US$ 350,000.00')
    expect(sp(formatProductPrice(350000, { currency: 'USD' }, pe, { whole: true }))).toBe('US$ 350,000')
    expect(sp(formatProductPrice(2800, { currency: null }, pe))).toBe('S/ 2,800.00')
    expect(sp(formatProductPrice(2800.5, null, pe, { whole: true }))).toBe('S/ 2,800.50')
    // English keeps the usual dollar sign.
    expect(sp(formatProductPrice(10, { currency: 'USD' }, { currency: 'PEN', locale: 'en', country: 'US' }))).toBe('$10.00')
  })

  it('parses currency cells', () => {
    expect(parseCurrency('usd')).toBe('USD')
    expect(parseCurrency('US$')).toBe('USD')
    expect(parseCurrency('Dólares')).toBe('USD')
    expect(parseCurrency('S/.')).toBe('PEN')
    expect(parseCurrency('soles')).toBe('PEN')
    expect(parseCurrency('$')).toBeNull() // ambiguous
    expect(parseCurrency('')).toBeNull()
    expect(PRODUCT_CURRENCIES).toEqual(expect.arrayContaining(['PEN', 'USD', 'EUR', 'MXN', 'COP', 'CLP', 'ARS']))
  })

  it('refuses foreign-currency products in the cart', () => {
    expect(cartCurrencyConflict({ currency: 'USD' }, 'PEN')).toBe('USD')
    expect(cartCurrencyConflict({ currency: null }, 'PEN')).toBeNull()
    expect(cartCurrencyConflict({ currency: 'PEN' }, 'PEN')).toBeNull()
  })
})

describe('catalog import "moneda" column', () => {
  it('maps and validates the currency column', () => {
    expect(guessMapping(['Nombre', 'Precio', 'Moneda'], [])).toEqual(['name', 'price', 'currency'])
    const ok = normalizeRow({ name: 'Casa', price: '350,000', currency: 'US$' }, [], 2)
    expect(ok.errors).toEqual([])
    expect(ok.data).toMatchObject({ price: 350000, currency: 'USD' })
    expect(productPayload(ok.data, null, 'create')).toMatchObject({ price: 350000, currency: 'USD' })
    expect(normalizeRow({ name: 'X', currency: 'pesitos' }, [], 3).errors).toEqual([{ field: 'currency', code: 'currency' }])
    // No column → not touched on update.
    expect('currency' in productPayload(normalizeRow({ name: 'Y' }, [], 4).data, null, 'update')).toBe(false)
  })
})

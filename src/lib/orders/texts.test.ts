import { describe, expect, it } from 'vitest'
import { fill, statusMessage, summaryText, texts } from './texts'

// Intl puts a no-break space after "S/"; normalize so assertions stay readable.
const money = (n: number) => new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' }).format(n).replace(/\u00a0/g, ' ')

describe('summaryText', () => {
  it('lists lines with line totals and shows delivery only when charged', () => {
    const lines = [
      { name: 'Ceviche', quantity: 2, unitPrice: 35 },
      { name: 'Chicha (1 L)', quantity: 1, unitPrice: 12.5 },
    ]
    const withDelivery = summaryText('es', '🛒 *Tu carrito*', lines, { subtotal: 82.5, deliveryFee: 7, total: 89.5 }, money)
    expect(withDelivery).toContain('• 2× Ceviche — S/ 70.00')
    expect(withDelivery).toContain('Delivery: S/ 7.00')
    expect(withDelivery).toContain('*Total*: *S/ 89.50*')
    const pickup = summaryText('es', 'x', lines, { subtotal: 82.5, deliveryFee: 0, total: 82.5 }, money)
    expect(pickup).not.toContain('Delivery')
  })
})

describe('statusMessage', () => {
  it('uses the fulfillment-specific "ready" text', () => {
    expect(statusMessage('es', 'ready', 'pickup', 12)).toContain('listo para recoger')
    expect(statusMessage('es', 'ready', 'delivery', 12)).toContain('saldrá pronto')
    expect(statusMessage('en', 'shipped', 'delivery', 7)).toBe('🛵 Your order *#7* is on its way.')
  })
  it('appends the cancel reason and skips pending', () => {
    expect(statusMessage('es', 'cancelled', 'pickup', 3, 'Nos quedamos sin stock.')).toBe('Tu pedido *#3* fue cancelado. Nos quedamos sin stock.')
    expect(statusMessage('es', 'pending', 'pickup', 3)).toBeNull()
  })
})

describe('button labels fit WhatsApp limits (20 chars)', () => {
  it.each(['es', 'en'] as const)('%s', (lang) => {
    for (const label of Object.values(texts(lang).buttons)) expect(label.length).toBeLessThanOrEqual(20)
    for (const label of Object.values(texts(lang).fulfillment)) expect(label.length).toBeLessThanOrEqual(20)
  })
})

describe('fill', () => {
  it('replaces known placeholders and blanks unknown ones', () => {
    expect(fill('Pedido #{number} {x}', { number: 5 })).toBe('Pedido #5 ')
  })
})

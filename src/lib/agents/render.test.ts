import { describe, expect, it } from 'vitest'
import type { OutboundContent } from '@/lib/channels/types'
import { renderForChannel } from './render'
import { AGENT_TEMPLATES, agentFromTemplate, templatesFor } from './templates'

const card = (i: number, buttons = 2) => ({
  id: `p${i}`,
  imageUrl: `https://x/${i}.jpg`,
  title: `Depa ${i}`,
  subtitle: 'US$ 250,000',
  buttons: [{ id: `visit:book:p${i}`, title: 'Agendar visita' }, { id: `cart:more:p${i}`, title: 'Ver ficha' }].slice(0, buttons),
})
const answer: OutboundContent[] = [
  { type: 'text', text: '¡Hola! Te muestro *2 opciones* en Miraflores:' },
  { type: 'carousel', text: 'Mira estas opciones:', cards: [card(1), card(2)] },
]

describe('agent test chat rendering', () => {
  it('WhatsApp keeps markup and shows a native carousel', () => {
    const b = renderForChannel('whatsapp', answer)
    expect(b.map((x) => x.kind)).toEqual(['text', 'carousel'])
    expect(b[0]).toMatchObject({ text: '¡Hola! Te muestro *2 opciones* en Miraflores:', markup: true })
    expect(b[1]).toMatchObject({ text: 'Mira estas opciones:', cards: [{ buttons: ['Agendar visita', 'Ver ficha'] }, { title: 'Depa 2' }] })
  })
  it('WhatsApp: one card is an image message with buttons; cards share the smallest button count', () => {
    expect(renderForChannel('whatsapp', [{ type: 'carousel', text: 'x', cards: [card(1)] }])[0]).toMatchObject({ kind: 'buttons', imageUrl: 'https://x/1.jpg', text: '*Depa 1*\nUS$ 250,000' })
    const mixed = renderForChannel('whatsapp', [{ type: 'carousel', text: 'x', cards: [card(1, 2), card(2, 1)] }])[0] as { cards: { buttons: string[] }[] }
    expect(mixed.cards.map((c) => c.buttons.length)).toEqual([1, 1])
  })
  it('Instagram shows text without markup, intro as its own message, then cards', () => {
    const b = renderForChannel('instagram', answer)
    expect(b.map((x) => x.kind)).toEqual(['text', 'text', 'carousel'])
    expect(b[0]).toMatchObject({ text: '¡Hola! Te muestro 2 opciones en Miraflores:', markup: false })
  })
  it('Messenger: photo caption comes as a separate message; >3 buttons become quick replies', () => {
    const b = renderForChannel('messenger', [
      { type: 'media', mediaType: 'image', url: 'https://x/p.jpg', caption: '*Ceviche* — S/ 35' },
      { type: 'buttons', text: 'Elige', options: [1, 2, 3, 4].map((i) => ({ id: `o${i}`, title: `Opción ${i}` })) },
    ])
    expect(b).toEqual([
      { kind: 'image', url: 'https://x/p.jpg', markup: false },
      { kind: 'text', text: 'Ceviche — S/ 35', markup: false },
      { kind: 'text', text: 'Elige', markup: false, quickReplies: ['Opción 1', 'Opción 2', 'Opción 3', 'Opción 4'] },
    ])
  })
  it('WhatsApp: more than 3 options become a list; long texts are split', () => {
    const b = renderForChannel('whatsapp', [{ type: 'buttons', text: 'Elige', options: [1, 2, 3, 4].map((i) => ({ id: `o${i}`, title: `Opción ${i}` })) }])
    expect(b[0].kind).toBe('list')
    expect(renderForChannel('instagram', [{ type: 'text', text: 'palabra '.repeat(300) }]).length).toBe(3)
  })
})

describe('agent templates', () => {
  it('only offers templates that fit the business', () => {
    expect(templatesFor('restaurant', { bookings: false, products: true, orders: true }).map((t) => t.key)).toEqual(['sales', 'support', 'router', 'blank'])
    expect(templatesFor('real_estate', { bookings: true, products: true }).map((t) => t.key)).toContain('real_estate')
  })
  it('drops skills of disabled modules', () => {
    const sales = AGENT_TEMPLATES.find((t) => t.key === 'sales')!
    expect(agentFromTemplate(sales, 'es', { products: true, orders: false }).skills).toEqual(['faq', 'catalog', 'handover'])
    expect(agentFromTemplate(sales, 'en', { products: true, orders: true })).toMatchObject({ name: 'Sales assistant', tone: 'friendly' })
  })
})

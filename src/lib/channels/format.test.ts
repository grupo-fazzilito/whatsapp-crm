import { describe, expect, it } from 'vitest'
import { channelText, splitText, stripMarkup } from './format'
import { metaMessages } from './adapters/meta-messaging'

describe('channel text rules', () => {
  it('strips WhatsApp markup without touching math or emails', () => {
    expect(stripMarkup('*Hola* _Ana_, tu cita es el ~lunes~ martes. ```ok```')).toBe('Hola Ana, tu cita es el lunes martes. ok')
    expect(stripMarkup('2*3*4 = 24 y mi_correo_x@test.pe')).toBe('2*3*4 = 24 y mi_correo_x@test.pe')
    expect(stripMarkup('Precio: *S/ 450,000* (USD)')).toBe('Precio: S/ 450,000 (USD)')
  })
  it('splits long texts at natural breaks under the limit', () => {
    const parts = splitText(`${'a'.repeat(700)}\n\n${'b'.repeat(500)}`, 1000)
    expect(parts).toEqual(['a'.repeat(700), 'b'.repeat(500)])
    expect(splitText('x'.repeat(2500), 1000).map((p) => p.length)).toEqual([1000, 1000, 500])
  })
  it('keeps markup on WhatsApp, removes it on Instagram and cuts at 1,000', () => {
    expect(channelText('whatsapp', '*Hola*')).toEqual(['*Hola*'])
    expect(channelText('instagram', '*Hola*')).toEqual(['Hola'])
    expect(channelText('instagram', 'x '.repeat(800)).length).toBe(2)
  })
})

describe('Messenger / Instagram messages', () => {
  it('send the caption of a photo as its own text', () => {
    expect(metaMessages('instagram', { type: 'media', mediaType: 'image', url: 'https://x/p.jpg', caption: '*Depa Miraflores* — US$ 250,000' })).toEqual([
      { attachment: { type: 'image', payload: { url: 'https://x/p.jpg', is_reusable: true } } },
      { text: 'Depa Miraflores — US$ 250,000' },
    ])
  })
  it('send the carousel intro before the cards', () => {
    const msgs = metaMessages('messenger', {
      type: 'carousel',
      text: 'Mira estas opciones:',
      cards: [{ id: 'p1', imageUrl: 'https://x/1.jpg', title: 'Ceviche', subtitle: 'S/ 35.00', buttons: [{ id: 'cart:add:p1', title: 'Agregar' }] }],
    })
    expect(msgs[0]).toEqual({ text: 'Mira estas opciones:' })
    expect((msgs[1] as { attachment: { payload: { elements: unknown[] } } }).attachment.payload.elements).toHaveLength(1)
  })
  it('quick replies up to 13, numbered menu beyond', () => {
    const opts = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `o${i}`, title: `Opción ${i + 1}` }))
    expect(metaMessages('messenger', { type: 'buttons', text: '*¿Qué deseas?*', options: opts(3) })[0]).toMatchObject({ text: '¿Qué deseas?', quick_replies: expect.any(Array) })
    expect((metaMessages('messenger', { type: 'buttons', text: 'Elige', options: opts(14) })[0] as { text: string }).text).toContain('14. Opción 14')
  })
})

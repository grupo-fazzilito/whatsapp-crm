import { describe, expect, it } from 'vitest'
import { SHARE_PHONE_ID, callbackData, hashOptionId, looksLikeBotToken, telegramRequests, toTelegramHtml } from './telegram'

describe('telegram outbound', () => {
  it('converts WhatsApp markup to escaped HTML', () => {
    expect(toTelegramHtml('*Total:* S/ 50 <b> & _gracias_')).toBe('<b>Total:</b> S/ 50 &lt;b&gt; &amp; <i>gracias</i>')
  })

  it('sends long texts in parts and keeps a plain fallback', () => {
    const reqs = telegramRequests({ type: 'text', text: 'a '.repeat(4000) })
    expect(reqs.length).toBe(3)
    expect(reqs[0]).toMatchObject({ method: 'sendMessage', body: { parse_mode: 'HTML' }, html: { field: 'text' } })
  })

  it('attaches buttons as an inline keyboard, hashing ids over 64 bytes', () => {
    const long = `cart:add:${'a'.repeat(36)}:${'b'.repeat(36)}`
    const [req] = telegramRequests({ type: 'buttons', text: '¿Cuál?', options: [{ id: 'cart:checkout', title: 'Pagar' }, { id: long, title: 'Rojo', description: 'S/ 20' }] })
    expect(req.body.reply_markup).toEqual({
      inline_keyboard: [[{ text: 'Pagar', callback_data: 'cart:checkout' }], [{ text: 'Rojo — S/ 20', callback_data: `h:${hashOptionId(long)}` }]],
    })
    expect(Buffer.byteLength(callbackData(long))).toBeLessThanOrEqual(64)
  })

  it('asks for the phone with Telegram’s share-contact keyboard', () => {
    const [req] = telegramRequests({ type: 'buttons', text: '¿Tu número?', options: [{ id: SHARE_PHONE_ID, title: 'Compartir' }] })
    expect(req.body.reply_markup).toEqual({ keyboard: [[{ text: 'Compartir', request_contact: true }]], one_time_keyboard: true, resize_keyboard: true })
  })

  it('maps media, carousels and locations to their Bot API methods', () => {
    expect(telegramRequests({ type: 'media', mediaType: 'image', url: 'https://x/a.jpg', caption: 'Hola' })).toEqual([
      { method: 'sendPhoto', body: { photo: 'https://x/a.jpg', caption: 'Hola', parse_mode: 'HTML' }, html: { field: 'caption', plain: 'Hola' } },
    ])
    expect(telegramRequests({ type: 'media', mediaType: 'document', url: 'https://x/a.pdf' })).toEqual([{ method: 'sendDocument', body: { document: 'https://x/a.pdf' } }])
    const carousel = telegramRequests({ type: 'carousel', text: 'Mira', cards: [{ id: 'p1', imageUrl: 'https://x/1.jpg', title: 'Polo', subtitle: 'S/ 30', buttons: [{ id: 'cart:add:p1', title: 'Agregar' }] }] })
    expect(carousel.map((r) => r.method)).toEqual(['sendMessage', 'sendPhoto'])
    expect(carousel[1].body.caption).toBe('<b>Polo</b>\nS/ 30')
    expect(telegramRequests({ type: 'location', latitude: 1, longitude: 2, name: 'Tienda', address: 'Av. 1' })).toEqual([
      { method: 'sendVenue', body: { latitude: 1, longitude: 2, title: 'Tienda', address: 'Av. 1' } },
    ])
    expect(() => telegramRequests({ type: 'template', templateName: 'x' })).toThrow()
  })

  it('recognizes BotFather tokens', () => {
    expect(looksLikeBotToken('123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw')).toBe(true)
    expect(looksLikeBotToken('hola')).toBe(false)
  })
})

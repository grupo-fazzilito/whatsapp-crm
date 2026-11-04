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

describe('telegram business sending', () => {
  it('knows a business-account channel by its connection id', async () => {
    const { businessConnectionId } = await import('./telegram')
    expect(businessConnectionId({ business_connection_id: 'BC1' })).toBe('BC1')
    expect(businessConnectionId({ username: 'bot' })).toBeNull()
  })
})

describe('telegram adapter send', () => {
  it('sends on behalf of the business account and drops the share-contact keyboard', async () => {
    const { vi } = await import('vitest')
    const { telegramAdapter, SHARE_PHONE_ID: share } = await import('./telegram')
    const calls: { url: string; body: Record<string, unknown> }[] = []
    const fetchMock = vi.fn(async (url: string, init: { body: string }) => {
      calls.push({ url, body: JSON.parse(init.body) })
      return new Response(JSON.stringify({ ok: true, result: { message_id: 42 } }))
    })
    vi.stubGlobal('fetch', fetchMock)
    const channel = { id: 'c', workspace_id: 'w', type: 'telegram', external_id: '999:BC1', settings: { business_connection_id: 'BC1' }, secrets: { access_token: '999:TOKEN' } }
    const res = await telegramAdapter.send(
      { channel: channel as never, recipient: '555' },
      { type: 'buttons', text: '¿Tu número?', options: [{ id: share, title: 'Compartir' }] },
    )
    expect(res.externalId).toBe('555_42')
    expect(calls[0].url).toContain('/bot999:TOKEN/sendMessage')
    expect(calls[0].body).toMatchObject({ chat_id: '555', business_connection_id: 'BC1' })
    expect(calls[0].body.reply_markup).toBeUndefined()
    vi.unstubAllGlobals()
  })
})

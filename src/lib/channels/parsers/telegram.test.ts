import { describe, expect, it } from 'vitest'
import { parseTelegramUpdate, parseTgMessageKey, tgMessageKey } from './telegram'

const from = { id: 555, first_name: 'Ana', last_name: 'Pérez', username: 'anaperez' }
const chat = { id: 555, type: 'private' }

describe('telegram updates', () => {
  it('reads a text message with the sender and a quoted message', () => {
    const { events, callbackQueryId } = parseTelegramUpdate('999', {
      update_id: 1,
      message: { message_id: 10, from, chat, date: 1_700_000_000, text: 'Hola, precio?', reply_to_message: { message_id: 7 } },
    })
    expect(callbackQueryId).toBeNull()
    expect(events).toEqual([
      {
        kind: 'message',
        channelExternalId: '999',
        from: { externalId: '555', name: 'Ana Pérez', handle: '@anaperez' },
        externalMessageId: '555_10',
        timestamp: 1_700_000_000_000,
        contentType: 'text',
        text: 'Hola, precio?',
        mediaUrl: undefined,
        replyToExternalId: '555_7',
      },
    ])
  })

  it('keeps the largest photo and the caption, and other files as proxied ids', () => {
    const photo = parseTelegramUpdate('999', {
      update_id: 2,
      message: { message_id: 11, from, chat, date: 1, caption: 'este', photo: [{ file_id: 'small' }, { file_id: 'big_one-1' }] },
    }).events[0]
    expect(photo).toMatchObject({ contentType: 'image', text: 'este', mediaUrl: 'tg-file:big_one-1' })
    const voice = parseTelegramUpdate('999', { update_id: 3, message: { message_id: 12, from, chat, date: 1, voice: { file_id: 'V' } } }).events[0]
    expect(voice).toMatchObject({ contentType: 'audio', mediaUrl: 'tg-file:V' })
    const doc = parseTelegramUpdate('999', { update_id: 4, message: { message_id: 13, from, chat, date: 1, document: { file_id: 'D', file_name: 'cotizacion.pdf' } } }).events[0]
    expect(doc).toMatchObject({ contentType: 'document', text: 'cotizacion.pdf', mediaUrl: 'tg-file:D' })
  })

  it('takes the phone only from the customer’s own shared contact', () => {
    const own = parseTelegramUpdate('999', {
      update_id: 5,
      message: { message_id: 14, from, chat, date: 1, contact: { phone_number: '+51 987 654 321', user_id: 555 } },
    }).events[0]
    expect(own).toMatchObject({ from: { externalId: '555', phone: '51987654321' }, text: '📱 +51987654321' })
    const someoneElse = parseTelegramUpdate('999', {
      update_id: 6,
      message: { message_id: 15, from, chat, date: 1, contact: { phone_number: '51911111111', user_id: 777 } },
    }).events[0]
    expect(someoneElse.kind === 'message' && someoneElse.from.phone).toBeFalsy()
  })

  it('turns a tapped button into an interactive reply with the button title', () => {
    const { events, callbackQueryId } = parseTelegramUpdate('999', {
      update_id: 7,
      callback_query: {
        id: 'CB1',
        from,
        data: 'cart:checkout',
        message: { message_id: 20, chat, date: 1, reply_markup: { inline_keyboard: [[{ text: 'Pagar', callback_data: 'cart:checkout' }]] } },
      },
    })
    expect(callbackQueryId).toBe('CB1')
    expect(events[0]).toMatchObject({ contentType: 'interactive', text: 'Pagar', interactiveReplyId: 'cart:checkout', externalMessageId: 'cb_CB1', replyToExternalId: '555_20' })
  })

  it('ignores groups, channels and bots', () => {
    expect(parseTelegramUpdate('999', { update_id: 8, message: { message_id: 1, from, chat: { id: -100, type: 'group' }, date: 1, text: 'x' } }).events).toEqual([])
    expect(parseTelegramUpdate('999', { update_id: 9, message: { message_id: 1, from: { ...from, is_bot: true }, chat, date: 1, text: 'x' } }).events).toEqual([])
    expect(parseTelegramUpdate('999', { update_id: 10 }).events).toEqual([])
  })

  it('round-trips stored message ids', () => {
    expect(parseTgMessageKey(tgMessageKey(555, 10))).toEqual({ chatId: '555', messageId: 10 })
    expect(parseTgMessageKey('wamid.X')).toBeNull()
  })
})

describe('telegram business', () => {
  const owner = { id: 900, first_name: 'Ana', username: 'ana_tienda' }
  const customer = { id: 555, first_name: 'Luis' }
  const chat = { id: 555, type: 'private' }

  it('reads the connection', () => {
    const conn = { id: 'BC1', user: owner, user_chat_id: 900, date: 1, rights: { can_reply: true }, is_enabled: true }
    expect(parseTelegramUpdate('999', { update_id: 1, business_connection: conn })).toMatchObject({ connection: conn, events: [], echo: null })
  })

  it('sends customer messages to the business-account channel', () => {
    const { events } = parseTelegramUpdate('999', { update_id: 2, business_message: { message_id: 5, business_connection_id: 'BC1', from: customer, chat, date: 10, text: 'precio?' } })
    expect(events[0]).toMatchObject({ channelExternalId: '999:BC1', from: { externalId: '555', name: 'Luis' }, externalMessageId: '555_5', text: 'precio?' })
  })

  it('treats what the owner writes as an echo, and skips what the bot sent', () => {
    const echo = parseTelegramUpdate('999', { update_id: 3, business_message: { message_id: 6, business_connection_id: 'BC1', from: owner, chat, date: 11, text: 'Cuesta 30' } })
    expect(echo.events).toEqual([])
    expect(echo.echo).toMatchObject({ channelExternalId: '999:BC1', message: { externalMessageId: '555_6', customer: '555', fromBusiness: true, content: { contentType: 'text', text: 'Cuesta 30' } } })
    const ours = parseTelegramUpdate('999', { update_id: 4, business_message: { message_id: 7, business_connection_id: 'BC1', from: owner, sender_business_bot: { id: 999, is_bot: true }, chat, date: 12, text: 'Hola' } })
    expect(ours).toMatchObject({ events: [], echo: null })
  })

  it('routes button taps on business messages to that channel', () => {
    const { events } = parseTelegramUpdate('999', {
      update_id: 5,
      callback_query: { id: 'CB', from: customer, data: 'cart:checkout', message: { message_id: 8, business_connection_id: 'BC1', chat, date: 1 } },
    })
    expect(events[0]).toMatchObject({ channelExternalId: '999:BC1', interactiveReplyId: 'cart:checkout' })
  })
})

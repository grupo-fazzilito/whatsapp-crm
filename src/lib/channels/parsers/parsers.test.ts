import { describe, expect, it } from 'vitest'
import { parseWhatsAppWebhook, type WaWebhookBody } from './whatsapp'
import { parseMetaMessagingWebhook, type MetaMessagingBody } from './meta-messaging'

const wa = (value: object): WaWebhookBody => ({
  object: 'whatsapp_business_account',
  entry: [{ id: 'WABA', changes: [{ field: 'messages', value: { metadata: { phone_number_id: 'PN1' }, ...value } }] }],
})

describe('parseWhatsAppWebhook', () => {
  it('parses a text message with profile name and phone', () => {
    const [ev] = parseWhatsAppWebhook(
      wa({
        contacts: [{ profile: { name: 'Ana' }, wa_id: '5215512345678' }],
        messages: [{ from: '5215512345678', id: 'wamid.1', timestamp: '1700000000', type: 'text', text: { body: 'Hola' } }],
      }),
    )
    expect(ev).toMatchObject({
      kind: 'message',
      channelExternalId: 'PN1',
      externalMessageId: 'wamid.1',
      contentType: 'text',
      text: 'Hola',
      timestamp: 1700000000000,
      from: { externalId: '5215512345678', name: 'Ana' },
    })
  })

  it('keeps media as a placeholder and caption as text', () => {
    const [ev] = parseWhatsAppWebhook(
      wa({ messages: [{ from: '1', id: 'm', timestamp: '1', type: 'image', image: { id: 'MEDIA9', caption: 'foto' } }] }),
    )
    expect(ev).toMatchObject({ contentType: 'image', text: 'foto', mediaUrl: 'wa-media:MEDIA9' })
  })

  it('maps button and list replies to interactive with the reply id', () => {
    const events = parseWhatsAppWebhook(
      wa({
        messages: [
          { from: '1', id: 'a', timestamp: '1', type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'yes', title: 'Sí' } } },
          { from: '1', id: 'b', timestamp: '1', type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: 'row2', title: 'Corte' } } },
          { from: '1', id: 'c', timestamp: '1', type: 'button', button: { payload: 'STOP', text: 'Detener' } },
        ],
      }),
    )
    expect(events.map((e) => (e.kind === 'message' ? [e.text, e.interactiveReplyId] : null))).toEqual([
      ['Sí', 'yes'],
      ['Corte', 'row2'],
      ['Detener', 'STOP'],
    ])
  })

  it('emits reactions (empty emoji = removal) and statuses', () => {
    const events = parseWhatsAppWebhook(
      wa({
        messages: [{ from: '1', id: 'r', timestamp: '1', type: 'reaction', reaction: { message_id: 'wamid.X', emoji: '' } }],
        statuses: [{ id: 'wamid.Y', status: 'read', timestamp: '2' }],
      }),
    )
    expect(events).toEqual([
      expect.objectContaining({ kind: 'status', externalMessageId: 'wamid.Y', status: 'read' }),
      expect.objectContaining({ kind: 'reaction', targetExternalId: 'wamid.X', emoji: null }),
    ])
  })

  it('carries swipe-reply context', () => {
    const [ev] = parseWhatsAppWebhook(
      wa({ messages: [{ from: '1', id: 'm', timestamp: '1', type: 'text', text: { body: 'x' }, context: { id: 'wamid.P' } }] }),
    )
    expect(ev).toMatchObject({ replyToExternalId: 'wamid.P' })
  })

  // Business-scoped user ids: https://developers.facebook.com/documentation/business-messaging/whatsapp/business-scoped-user-ids
  it('identifies a customer with a username and no shared phone by their BSUID', () => {
    const [ev] = parseWhatsAppWebhook(
      wa({
        contacts: [{ profile: { name: 'Sheena Nelson', username: 'realsheenanelson' }, user_id: 'US.13491208655302741918' }],
        messages: [{ from_user_id: 'US.13491208655302741918', id: 'wamid.B', timestamp: '1', type: 'text', text: { body: 'Does it come in another color?' } }],
      }),
    )
    expect(ev).toMatchObject({
      kind: 'message',
      text: 'Does it come in another color?',
      from: { externalId: 'US.13491208655302741918', userId: 'US.13491208655302741918', phone: null, name: 'Sheena Nelson', handle: '@realsheenanelson' },
    })
  })

  it('keeps the phone as the id and carries the BSUID along when both come', () => {
    const [ev] = parseWhatsAppWebhook(
      wa({
        contacts: [{ profile: { name: 'Ana' }, wa_id: '51987654321', user_id: 'PE.778899' }],
        messages: [{ from: '51987654321', from_user_id: 'PE.778899', id: 'wamid.C', timestamp: '1', type: 'text', text: { body: 'Hola' } }],
      }),
    )
    expect(ev).toMatchObject({ from: { externalId: '51987654321', phone: '51987654321', userId: 'PE.778899', name: 'Ana' } })
  })

  it('skips a message with neither phone nor BSUID instead of failing the batch', () => {
    const events = parseWhatsAppWebhook(
      wa({
        messages: [
          { id: 'wamid.X', timestamp: '1', type: 'text', text: { body: '?' } },
          { from: '51911', id: 'wamid.Y', timestamp: '1', type: 'text', text: { body: 'ok' } },
        ],
      }),
    )
    expect(events.map((e) => e.kind === 'message' && e.externalMessageId)).toEqual(['wamid.Y'])
  })

  it('turns number and BSUID changes into identity changes, not chat messages', () => {
    const events = parseWhatsAppWebhook(
      wa({
        messages: [
          {
            from: '16505551234', id: 'wamid.S1', timestamp: '5', type: 'system',
            system: { type: 'user_changed_number', wa_id: '12195555358', user_id: 'US.134912', previous_user_id: 'US.102309' },
          },
          {
            id: 'wamid.S2', timestamp: '6', type: 'system',
            system: { type: 'user_changed_user_id', user_id: 'US.555', previous_user_id: 'US.444' },
          },
        ],
      }),
    )
    expect(events).toEqual([
      { kind: 'identity_change', channelExternalId: 'PN1', previous: { phone: '16505551234', userId: 'US.102309' }, current: { phone: '12195555358', userId: 'US.134912' }, timestamp: 5000 },
      { kind: 'identity_change', channelExternalId: 'PN1', previous: { phone: null, userId: 'US.444' }, current: { phone: null, userId: 'US.555' }, timestamp: 6000 },
    ])
  })
})

const page = (object: string, messaging: unknown[]) =>
  ({ object, entry: [{ id: 'PAGE1', time: 1, messaging }] }) as MetaMessagingBody

describe('parseMetaMessagingWebhook', () => {
  it('parses Messenger text and skips echoes', () => {
    const events = parseMetaMessagingWebhook(
      page('page', [
        { sender: { id: 'PSID1' }, recipient: { id: 'PAGE1' }, timestamp: 5, message: { mid: 'm1', text: 'hola' } },
        { sender: { id: 'PAGE1' }, recipient: { id: 'PSID1' }, timestamp: 6, message: { mid: 'm2', text: 'eco', is_echo: true } },
      ]),
    )
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ kind: 'message', channelExternalId: 'PAGE1', from: { externalId: 'PSID1' }, text: 'hola', timestamp: 5 })
  })

  it('maps quick replies and postbacks to interactive', () => {
    const events = parseMetaMessagingWebhook(
      page('instagram', [
        { sender: { id: 'IG1' }, recipient: { id: 'PAGE1' }, timestamp: 1, message: { mid: 'q', text: 'Corte', quick_reply: { payload: 'svc_cut' } } },
        { sender: { id: 'IG1' }, recipient: { id: 'PAGE1' }, timestamp: 2, postback: { mid: 'p', title: 'Empezar', payload: 'GET_STARTED' } },
      ]),
    )
    expect(events.map((e) => (e.kind === 'message' ? e.interactiveReplyId : null))).toEqual(['svc_cut', 'GET_STARTED'])
  })

  it('parses attachments, reactions and deliveries', () => {
    const events = parseMetaMessagingWebhook(
      page('instagram', [
        { sender: { id: 'IG1' }, recipient: { id: 'PAGE1' }, timestamp: 1, message: { mid: 'img', attachments: [{ type: 'image', payload: { url: 'https://cdn/x.jpg' } }] } },
        { sender: { id: 'IG1' }, recipient: { id: 'PAGE1' }, timestamp: 2, reaction: { mid: 'target', action: 'react', emoji: '❤' } },
        { sender: { id: 'IG1' }, recipient: { id: 'PAGE1' }, timestamp: 3, delivery: { mids: ['out1'], watermark: 3 } },
      ]),
    )
    expect(events[0]).toMatchObject({ contentType: 'image', mediaUrl: 'https://cdn/x.jpg' })
    expect(events[1]).toMatchObject({ kind: 'reaction', targetExternalId: 'target', emoji: '❤' })
    expect(events[2]).toMatchObject({ kind: 'status', externalMessageId: 'out1', status: 'delivered' })
  })
})

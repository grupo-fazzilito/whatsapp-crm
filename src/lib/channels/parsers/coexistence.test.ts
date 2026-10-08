import { describe, expect, it } from 'vitest'
import { HISTORY_LIMITS, parseWhatsAppCoexistence, parseWhatsAppWebhook, type WaWebhookBody } from './whatsapp'

// Fixtures modeled on the payload examples of Meta's "Onboarding WhatsApp
// Business app users" guide (coexistence).
const META = { display_phone_number: '15550783881', phone_number_id: '106540352242922' }
const wrap = (field: string, value: Record<string, unknown>): WaWebhookBody =>
  ({
    object: 'whatsapp_business_account',
    entry: [{ id: '102290129340398', changes: [{ field, value: { messaging_product: 'whatsapp', metadata: META, ...value } }] }],
  }) as unknown as WaWebhookBody

const ECHO = wrap('smb_message_echoes', {
  message_echoes: [
    {
      from: '15550783881',
      to: '16505551234',
      id: 'wamid.HBgLMTY0NjcwNDM1OTUVAgARGBIyNDlBOEI5QUQ4NDc0N0FCNjMA',
      timestamp: '1700255121',
      type: 'text',
      text: { body: "Here's the info you requested! https://www.meta.com/quest/quest-3/" },
    },
  ],
})

const HISTORY = wrap('history', {
  history: [
    {
      metadata: { phase: 0, chunk_order: 1, progress: 55 },
      threads: [
        {
          id: '16505551234',
          messages: [
            { from: '15550783881', id: 'wamid.H1', timestamp: '1739230955', type: 'text', text: { body: "Here's the info" }, history_context: { status: 'READ' } },
            { from: '15550783881', id: 'wamid.H2', timestamp: '1739230970', type: 'media_placeholder', history_context: { status: 'PLAYED' } },
            { from: '16505551234', id: 'wamid.H3', timestamp: '1739230970', type: 'text', text: { body: 'Thanks!' }, history_context: { status: 'READ' } },
          ],
        },
        {
          id: '12125557890',
          messages: [{ from: '15550783881', id: 'wamid.H4', timestamp: '1739230970', type: 'text', text: { body: 'Thanks for your order!' }, history_context: { status: 'DELIVERED' } }],
        },
      ],
    },
  ],
})

const HISTORY_MEDIA = wrap('history', {
  messages: [
    {
      from: '16505551234',
      id: 'wamid.QyNUEHBgLMTY0NjcwNDM1OTUVAgARGBI1Rj3NEYxMzAzMzQ5MkEA',
      timestamp: '1738796547',
      type: 'image',
      image: { caption: 'Black Prince echeveria', mime_type: 'image/jpeg', sha256: 'x', id: '24230790383178626' },
    },
  ],
})

const HISTORY_DECLINED = wrap('history', {
  history: [
    {
      errors: [
        {
          code: 2593109,
          title: 'History sync is turned off by the business from the WhatsApp Business App',
          message: 'History sync is turned off by the business from the WhatsApp Business App',
          error_data: { details: 'History sharing is turned off by the business' },
        },
      ],
    },
  ],
})

const STATE_SYNC = wrap('smb_app_state_sync', {
  state_sync: [
    { type: 'contact', contact: { full_name: 'Diego Ramos', first_name: 'Diego', phone_number: '16505551234' }, action: 'add', metadata: { timestamp: '1700255121' } },
    { type: 'contact', contact: { full_name: 'Old', phone_number: '+1 212 555 7890' }, action: 'remove', metadata: { timestamp: '1700255122' } },
    { type: 'unknown' },
  ],
})

describe('parseWhatsAppCoexistence', () => {
  it('smb_message_echoes → outbound messages to the customer in `to`', () => {
    const [b] = parseWhatsAppCoexistence(ECHO)
    expect(b.phoneNumberId).toBe('106540352242922')
    expect(b.echoes).toHaveLength(1)
    expect(b.echoes[0]).toMatchObject({
      customer: '16505551234',
      fromBusiness: true,
      timestamp: 1700255121000,
      content: { contentType: 'text', text: "Here's the info you requested! https://www.meta.com/quest/quest-3/" },
    })
  })

  it('history threads → messages with direction from the thread id, progress kept', () => {
    const [b] = parseWhatsAppCoexistence(HISTORY)
    expect(b.historyProgress).toEqual({ phase: 0, chunk: 1, progress: 55 })
    expect(b.history.map((m) => [m.externalMessageId, m.customer, m.fromBusiness])).toEqual([
      ['wamid.H1', '16505551234', true],
      ['wamid.H2', '16505551234', true],
      ['wamid.H3', '16505551234', false],
      ['wamid.H4', '12125557890', true],
    ])
    expect(b.history[0].phoneStatus).toBe('read')
    expect(b.history[1].content).toEqual({ contentType: 'text', text: '[Media]' })
  })

  it('history media webhook → content for the placeholder', () => {
    const [b] = parseWhatsAppCoexistence(HISTORY_MEDIA)
    expect(b.historyMedia[0]).toMatchObject({
      customer: '16505551234',
      fromBusiness: false,
      content: { contentType: 'image', text: 'Black Prince echeveria', mediaUrl: 'wa-media:24230790383178626' },
    })
  })

  it('history declined by the business → error recorded, nothing imported', () => {
    const [b] = parseWhatsAppCoexistence(HISTORY_DECLINED)
    expect(b.history).toHaveLength(0)
    expect(b.historyError).toEqual({ code: 2593109, message: 'History sync is turned off by the business from the WhatsApp Business App' })
  })

  it('smb_app_state_sync → contacts with digits-only phones', () => {
    const [b] = parseWhatsAppCoexistence(STATE_SYNC)
    expect(b.contacts).toEqual([
      { phone: '16505551234', name: 'Diego Ramos', action: 'add', timestamp: 1700255121000 },
      { phone: '12125557890', name: 'Old', action: 'remove', timestamp: 1700255122000 },
    ])
  })

  it('bounds threads per webhook', () => {
    const threads = Array.from({ length: HISTORY_LIMITS.threads + 5 }, (_, i) => ({
      id: String(10000000 + i),
      messages: [{ from: String(10000000 + i), id: `w${i}`, timestamp: '1', type: 'text', text: { body: 'x' } }],
    }))
    const [b] = parseWhatsAppCoexistence(wrap('history', { history: [{ metadata: { phase: 1 }, threads }] }))
    expect(b.history).toHaveLength(HISTORY_LIMITS.threads)
  })

  it('ignores plain inbound messages', () => {
    expect(parseWhatsAppCoexistence(wrap('messages', { messages: [{ from: '1', id: 'x', timestamp: '1', type: 'text', text: { body: 'hi' } }] }))).toEqual([])
  })
})

describe('parseWhatsAppWebhook with coexistence fields', () => {
  it('never turns echoes or history into inbound customer messages', () => {
    expect(parseWhatsAppWebhook(ECHO)).toEqual([])
    expect(parseWhatsAppWebhook(HISTORY)).toEqual([])
    expect(parseWhatsAppWebhook(HISTORY_MEDIA)).toEqual([])
    expect(parseWhatsAppWebhook(STATE_SYNC)).toEqual([])
  })
})

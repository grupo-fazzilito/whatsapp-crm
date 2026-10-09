import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: vi.fn() }))
vi.mock('./ingest', () => ({ findOrCreateContact: vi.fn(), findOrCreateConversation: vi.fn() }))

import { COEX_SOURCE, coexMessageRow, groupByCustomer, isPlaceholderName, mediaUrlFor } from './echo'
import type { CoexMessage } from '@/lib/channels/parsers/whatsapp'

const msg = (over: Partial<CoexMessage> = {}): CoexMessage => ({
  externalMessageId: 'wamid.1',
  customer: '51987654321',
  fromBusiness: true,
  timestamp: 1700255121000,
  content: { contentType: 'text', text: 'Hola' },
  ...over,
})
const ctx = { workspaceId: 'ws', conversationId: 'conv', channelId: 'ch', history: false }

describe('coexMessageRow', () => {
  it('echo → human agent message from the phone, not AI', () => {
    expect(coexMessageRow(msg(), ctx)).toMatchObject({
      sender_type: 'agent',
      sender_id: null,
      content_type: 'text',
      content_text: 'Hola',
      message_id: 'wamid.1',
      status: 'sent',
      created_at: '2023-11-17T21:05:21.000Z',
      metadata: { source: COEX_SOURCE },
    })
  })

  it('history rows are flagged and keep the phone status', () => {
    const out = coexMessageRow(msg({ phoneStatus: 'played' }), { ...ctx, history: true })
    expect(out.metadata).toEqual({ source: COEX_SOURCE, history: true })
    expect(out.status).toBe('read')
    const inbound = coexMessageRow(msg({ fromBusiness: false }), { ...ctx, history: true })
    expect(inbound.sender_type).toBe('customer')
  })

  it('media goes through the proxy; stickers are stored as images', () => {
    const out = coexMessageRow(msg({ content: { contentType: 'sticker', text: null, mediaUrl: 'wa-media:123' } }), ctx)
    expect(out.content_type).toBe('image')
    expect(out.media_url).toBe('/api/media/ch/123')
    expect(mediaUrlFor('ch', null)).toBeNull()
  })
})

describe('helpers', () => {
  it('groups by customer and drops duplicate ids', () => {
    const g = groupByCustomer([msg(), msg(), msg({ externalMessageId: 'b', customer: '2' }), msg({ externalMessageId: 'c' })])
    expect([...g.keys()]).toEqual(['51987654321', '2'])
    expect(g.get('51987654321')!.map((m) => m.externalMessageId)).toEqual(['wamid.1', 'c'])
  })

  it('only placeholder names get replaced by the address book', () => {
    expect(isPlaceholderName(null, '51987654321')).toBe(true)
    expect(isPlaceholderName('51987654321', '51987654321')).toBe(true)
    expect(isPlaceholderName('+51 987 654 321', '51987654321')).toBe(true)
    expect(isPlaceholderName('whatsapp 4321', '51987654321')).toBe(true)
    expect(isPlaceholderName('Diego Ramos', '51987654321')).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import { decodeDmMedia, encodeDmMedia, isDmWindowError, parseDirectMessage } from './model'
import { tiktokCanMessage } from './scopes'

// Shape from TikTok's "Webhooks for Business Messaging" guide: `content` is a JSON string.
const webhook = (event: string, content: Record<string, unknown>) => ({
  client_key: 'app',
  event,
  create_time: 1_763_000_000,
  user_openid: 'biz-open-id',
  content: JSON.stringify(content),
})

const inbound = {
  conversation_id: 'conv+1/abc==',
  message_id: '7400000000000000123',
  timestamp: 1_763_000_000_123,
  from: 'maria.lopez',
  to: 'fazzilwood',
  from_user: { id: 'cust-1', role: 'personal_account' },
  to_user: { id: 'biz-open-id', role: 'business_account' },
  type: 'text',
  text: { body: 'Hola, ¿precio?' },
}

describe('direct message webhook', () => {
  it('reads a text a customer sent', () => {
    expect(parseDirectMessage(webhook('im_receive_msg', inbound))).toEqual({
      openId: 'biz-open-id',
      conversationId: 'conv+1/abc==',
      messageId: '7400000000000000123',
      timestamp: 1_763_000_000_123,
      fromBusiness: false,
      source: null,
      customerUsername: 'maria.lopez',
      contentType: 'text',
      text: 'Hola, ¿precio?',
      mediaId: null,
    })
  })

  it('keeps every digit of a numeric message id', () => {
    const raw = { ...webhook('im_receive_msg', inbound), content: JSON.stringify(inbound).replace('"7400000000000000123"', '7400000000000000123') }
    expect(parseDirectMessage(raw)?.messageId).toBe('7400000000000000123')
  })

  it('reads images with their media id, and timestamps in seconds', () => {
    const ev = parseDirectMessage(webhook('im_receive_msg', { ...inbound, type: 'image', text: undefined, image: { media_id: 'm-9' }, timestamp: 1_763_000_000 }))
    expect(ev).toMatchObject({ contentType: 'image', mediaId: 'm-9', text: null, timestamp: 1_763_000_000_000 })
  })

  it('marks what the business sent and where from', () => {
    const ev = parseDirectMessage(
      webhook('im_send_msg', { ...inbound, from: 'fazzilwood', to: 'maria.lopez', from_user: { role: 'business_account' }, message_tag: { source: 'APP' } }),
    )
    expect(ev).toMatchObject({ fromBusiness: true, source: 'APP', customerUsername: 'maria.lopez' })
  })

  it('ignores EU senders (no content), reactions, comments and junk', () => {
    expect(parseDirectMessage({ ...webhook('im_receive_msg_eu', {}), content: JSON.stringify({ to: 'x', timestamp: 1 }) })).toBeNull()
    expect(parseDirectMessage(webhook('im_receive_msg', { ...inbound, type: 'reaction' }))).toBeNull()
    expect(parseDirectMessage(webhook('comment.update', inbound))).toBeNull()
    expect(parseDirectMessage(webhook('im_receive_msg', { ...inbound, conversation_id: '' }))).toBeNull()
    expect(parseDirectMessage({ event: 'im_receive_msg', user_openid: 'x', content: '{bad' })).toBeNull()
    expect(parseDirectMessage(null)).toBeNull()
  })
})

describe('direct message helpers', () => {
  it('round-trips the media reference through a url-safe token', () => {
    const ref = { conversationId: 'conv+1/abc==', messageId: '74', mediaId: 'm-9', mediaType: 'IMAGE' as const }
    const token = encodeDmMedia(ref)
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(decodeDmMedia(token)).toEqual(ref)
    expect(decodeDmMedia('not-a-token')).toBeNull()
  })

  it('knows when a connection can message', () => {
    expect(tiktokCanMessage(['user.info.basic', 'comment.list'])).toBe(false)
    expect(tiktokCanMessage(['message.list.read', 'message.list.send'])).toBe(true)
    expect(tiktokCanMessage(['message.list.manage'])).toBe(true)
    expect(tiktokCanMessage(undefined)).toBe(false)
  })

  it('recognizes a closed reply window', () => {
    expect(isDmWindowError(40064, 'blocked')).toBe(true)
    expect(isDmWindowError(40001, 'Invalid param')).toBe(false)
  })
})

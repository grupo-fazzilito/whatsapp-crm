import crypto from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { authorizeUrl, parseCommentUpdate, quoteBigInts, tiktokRedirectUri, tokenNeedsRefresh, verifyTiktokSignature } from './model'

const SECRET = 'app-secret'
const signed = (raw: string, t: number, secret = SECRET) => `t=${t},s=${crypto.createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex')}`

describe('webhook signature', () => {
  const raw = '{"event":"comment.update","user_openid":"abc"}'
  const now = 1_700_000_000

  it('accepts a fresh delivery signed with the app secret', () => {
    expect(verifyTiktokSignature(raw, signed(raw, now), SECRET, now + 3)).toBe(true)
  })

  it('refuses another secret, a changed body, stale deliveries and junk headers', () => {
    expect(verifyTiktokSignature(raw, signed(raw, now, 'other'), SECRET, now)).toBe(false)
    expect(verifyTiktokSignature(raw.replace('abc', 'abd'), signed(raw, now), SECRET, now)).toBe(false)
    expect(verifyTiktokSignature(raw, signed(raw, now), SECRET, now + 3600)).toBe(false)
    expect(verifyTiktokSignature(raw, null, SECRET, now)).toBe(false)
    expect(verifyTiktokSignature(raw, 't=x,s=zz', SECRET, now)).toBe(false)
    expect(verifyTiktokSignature(raw, signed(raw, now), '', now)).toBe(false)
  })
})

describe('comment.update', () => {
  // The example payload from TikTok's docs: ids are bare numbers above 2^53.
  const body = {
    client_key: 'bwo1m23456a7k89',
    event: 'comment.update',
    create_time: 1615338610,
    user_openid: '_000abPL1cJIdVefgDhGijkl2mFn3AB0abY4',
    content:
      '{"comment_id":7247303576418566913,"video_id":7203946942097902849,"parent_comment_id":7235861947622916866,"comment_type":"reply","comment_action":"delete","unique_identifier":"+ABc1D2/E0fGhijklMNOrD34vDW/zDiZUNRH5Jyahue6OcA7b8ZpwnqXV9u1Uh+k","timestamp":1687394416109,"text":"text"}',
  }

  it('keeps every digit of the ids', () => {
    expect(parseCommentUpdate(body)).toEqual({
      openId: '_000abPL1cJIdVefgDhGijkl2mFn3AB0abY4',
      commentId: '7247303576418566913',
      videoId: '7203946942097902849',
      parentId: '7235861947622916866',
      type: 'reply',
      action: 'delete',
      authorId: '+ABc1D2/E0fGhijklMNOrD34vDW/zDiZUNRH5Jyahue6OcA7b8ZpwnqXV9u1Uh+k',
      text: 'text',
    })
  })

  it('reads a new top-level comment and ignores other events', () => {
    const insert = { ...body, content: '{"comment_id":"7300000000000000001","video_id":"7300000000000000002","comment_type":"comment","comment_action":"insert","text":"¿precio?"}' }
    expect(parseCommentUpdate(insert)).toMatchObject({ commentId: '7300000000000000001', parentId: null, type: 'comment', action: 'insert', authorId: null, text: '¿precio?' })
    expect(parseCommentUpdate({ ...body, event: 'share.video.publish_complete' })).toBeNull()
    expect(parseCommentUpdate({ ...body, content: 'not json' })).toBeNull()
  })

  it('quotes long numbers only, wherever they appear', () => {
    expect(JSON.parse(quoteBigInts('{"a":7247303576418566913,"b":[7203946942097902849],"n":42,"t":1687394416109}'))).toEqual({
      a: '7247303576418566913',
      b: ['7203946942097902849'],
      n: 42,
      t: 1687394416109,
    })
  })
})

describe('oauth', () => {
  it('adds our state to the app authorization URL and ends the redirect URL with a slash', () => {
    const url = new URL(authorizeUrl('https://www.tiktok.com/v2/auth/authorize?client_key=abc&scope=user.info.basic', 'signed.state'))
    expect(url.searchParams.get('client_key')).toBe('abc')
    expect(url.searchParams.get('state')).toBe('signed.state')
    expect(tiktokRedirectUri('https://whasalia.com/')).toBe('https://whasalia.com/api/channels/tiktok/oauth/callback/')
  })

  it('renews the one-day token shortly before it expires', () => {
    const now = 1_000_000_000_000
    expect(tokenNeedsRefresh(String(now + 3_600_000), now)).toBe(false)
    expect(tokenNeedsRefresh(String(now + 60_000), now)).toBe(true)
    expect(tokenNeedsRefresh(undefined, now)).toBe(true)
  })
})

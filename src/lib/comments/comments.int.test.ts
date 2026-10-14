// Comment auto-replies end to end against a real Postgres, with the Graph
// API faked on fetch. TEST_DATABASE_URL=postgresql://crm:crm@127.0.0.1:5434/crm npx vitest run src/lib/comments
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { pgTest } from '@/lib/test-utils/pg'
import type { CommentEvent } from './model'

vi.mock('server-only', () => ({}))
const pg = await pgTest()

const calls: { url: string; body: Record<string, unknown> | null }[] = []
const fake = { privateFails: false }

describe.skipIf(!pg)('comment auto-replies', async () => {
  if (!pg) return
  const realFetch = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (!href.startsWith('https://graph.facebook.com/')) return realFetch(input, init)
    const url = new URL(href)
    const body = init?.body ? JSON.parse(String(init.body)) : null
    calls.push({ url: url.pathname, body })
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } })
    if (url.searchParams.get('access_token') !== 'page-token') return json({ error: { message: 'Invalid OAuth access token', code: 190 } }, 400)
    if (url.pathname.endsWith('/messages')) {
      if (fake.privateFails) return json({ error: { message: '(#10) This message is sent outside of allowed window.', code: 10 } }, 400)
      return json({ recipient_id: `IGSID-${body.recipient.comment_id}`, message_id: `mid-${body.recipient.comment_id}` })
    }
    if (url.pathname.endsWith('/replies')) return json({ id: `reply-${calls.length}` })
    return json({ error: { message: 'unhandled' } }, 404)
  })

  const { handleComment } = await import('./server')
  const { saveChannelSecrets, loadChannel } = await import('@/lib/channels/store')
  const ws = await pg.workspace()
  let channelId = ''
  const ev = (commentId: string, text: string, from = 'U1', postId = 'M1'): CommentEvent => ({
    channelType: 'instagram', channelExternalId: 'IG-TEST-1', commentId, postId, parentId: null, from: { id: from, name: 'ana.pe' }, text,
  })
  const channel = async () => (await loadChannel(ws.workspaceId, channelId))!

  beforeAll(async () => {
    const c = await ws.db.channels.create({
      data: { workspace_id: ws.workspaceId, type: 'instagram', name: 'IG', external_id: `IG-TEST-${ws.workspaceId}`, settings: { page_id: 'PAGE-1' } },
      select: { id: true },
    })
    channelId = c.id
    await saveChannelSecrets(channelId, { access_token: 'page-token' })
    await ws.db.comment_rules.create({
      data: { workspace_id: ws.workspaceId, name: 'Precio', keywords: ['precio'], public_replies: ['¡Te escribimos {nombre}! 📩'], private_message: 'Hola {nombre}, cuesta S/ 50.' },
    })
  })
  afterAll(async () => {
    vi.restoreAllMocks()
    await pg.cleanup(ws)
  })

  it('replies in public and in private, and opens the conversation in the inbox', async () => {
    expect(await handleComment(await channel(), ev('C1', '¿Precio?'))).toBe('replied')
    expect(calls.find((c) => c.url.endsWith('/C1/replies'))?.body).toEqual({ message: '¡Te escribimos ana.pe! 📩' })
    expect(calls.find((c) => c.url.endsWith('/PAGE-1/messages'))?.body).toEqual({ recipient: { comment_id: 'C1' }, message: { text: 'Hola ana.pe, cuesta S/ 50.' } })

    const log = await ws.db.comment_replies.findFirstOrThrow({ where: { comment_id: 'C1' } })
    expect(log).toMatchObject({ status: 'replied', author_id: 'U1', private_message_id: 'mid-C1', error: null })
    const identity = await ws.db.contact_identities.findFirstOrThrow({ where: { external_id: 'IGSID-C1' } })
    const conv = await ws.db.conversations.findFirstOrThrow({ where: { id: log.conversation_id! } })
    expect(conv).toMatchObject({ contact_id: identity.contact_id, channel_id: channelId, last_message_text: 'Hola ana.pe, cuesta S/ 50.' })
    const msg = await ws.db.messages.findFirstOrThrow({ where: { conversation_id: conv.id } })
    expect(msg).toMatchObject({ sender_type: 'bot', message_id: 'mid-C1', status: 'sent' })
    expect(msg.metadata).toMatchObject({ source: 'comment_reply', comment_text: '¿Precio?' })
    expect((await ws.db.comment_rules.findFirstOrThrow({})).replies_count).toBe(1)
  })

  it('handles a webhook retry once, and the same person once per post', async () => {
    const before = calls.length
    expect(await handleComment(await channel(), ev('C1', '¿Precio?'))).toBe('duplicate')
    expect(await handleComment(await channel(), ev('C2', 'precio por favor'))).toBe('skipped')
    expect(calls.length).toBe(before)
    // Another post is a new chance.
    expect(await handleComment(await channel(), ev('C3', 'precio', 'U1', 'M2'))).toBe('replied')
  })

  it('leaves comments without a keyword alone, and its own replies too', async () => {
    const before = calls.length
    expect(await handleComment(await channel(), ev('C4', 'qué bonito', 'U2'))).toBe('no_rule')
    expect(await handleComment(await channel(), ev('C5', 'precio', 'PAGE-1'))).toBe('no_rule')
    expect(calls.length).toBe(before)
    expect(await ws.db.comment_replies.count({ where: { comment_id: { in: ['C4', 'C5'] } } })).toBe(0)
  })

  it('records a partial reply when the private message fails', async () => {
    fake.privateFails = true
    expect(await handleComment(await channel(), ev('C6', 'PRECIO', 'U3'))).toBe('partial')
    const log = await ws.db.comment_replies.findFirstOrThrow({ where: { comment_id: 'C6' } })
    expect(log.status).toBe('partial')
    expect(log.error).toMatch(/Mensaje privado: falta permiso/)
    fake.privateFails = false
  })

  it('does not count failures and reports a lost token', async () => {
    await saveChannelSecrets(channelId, { access_token: 'expired' })
    expect(await handleComment(await channel(), ev('C7', 'precio', 'U4'))).toBe('failed')
    const rule = await ws.db.comment_rules.findFirstOrThrow({})
    expect(rule.replies_count).toBe(3)
    // Failed answers don't block a later comment of the same person.
    await saveChannelSecrets(channelId, { access_token: 'page-token' })
    expect(await handleComment(await channel(), ev('C8', 'precio', 'U4'))).toBe('replied')
  })
})

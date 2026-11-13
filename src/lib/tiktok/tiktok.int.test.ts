// TikTok comment replies end to end against a real Postgres, with the
// TikTok API for Business faked on fetch (bare 19-digit ids included).
// TEST_DATABASE_URL=postgresql://crm:crm@127.0.0.1:5434/crm_migrated npx vitest run src/lib/tiktok
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { pgTest } from '@/lib/test-utils/pg'
import type { TiktokCommentEvent } from './model'

vi.mock('server-only', () => ({}))
vi.stubEnv('TIKTOK_APP_ID', 'app-1')
vi.stubEnv('TIKTOK_APP_SECRET', 'secret-1')
vi.stubEnv('TIKTOK_AUTH_URL', 'https://www.tiktok.com/v2/auth/authorize?client_key=app-1')
const pg = await pgTest()

const calls: { path: string; token: string | null; query: Record<string, string>; body: Record<string, unknown> | null }[] = []
const fake = { owner: false }

describe.skipIf(!pg)('TikTok comment replies', async () => {
  if (!pg) return
  const realFetch = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (!href.startsWith('https://business-api.tiktok.com/')) return realFetch(input, init)
    const url = new URL(href)
    const path = url.pathname.replace('/open_api/v1.3', '')
    const headers = new Headers(init?.headers)
    const body = init?.body ? JSON.parse(String(init.body)) : null
    calls.push({ path, token: headers.get('access-token'), query: Object.fromEntries(url.searchParams), body })
    // Raw text: TikTok sends ids as bare numbers above 2^53.
    const raw = (text: string) => new Response(text, { status: 200, headers: { 'Content-Type': 'application/json' } })
    if (path === '/tt_user/oauth2/refresh_token/') {
      return raw('{"code":0,"message":"OK","data":{"access_token":"fresh-token","refresh_token":"r2","expires_in":86400,"open_id":"OPEN-1","scope":"comment.list"}}')
    }
    if (headers.get('access-token') !== 'fresh-token') return raw('{"code":40105,"message":"The access token is invalid or not found in the request."}')
    if (path === '/business/comment/list/') {
      return raw(`{"code":0,"message":"OK","data":{"comments":[{"comment_id":7300000000000000001,"video_id":7300000000000000002,"username":"ana.pe","display_name":"Ana Pérez","owner":${fake.owner},"text":"¿Cuál es el precio?"}]}}`)
    }
    if (path === '/business/comment/reply/create/') {
      return raw('{"code":0,"message":"OK","data":{"comment_id":7300000000000000099,"parent_comment_id":7300000000000000001,"video_id":7300000000000000002}}')
    }
    return raw('{"code":40002,"message":"unhandled"}')
  })

  const { handleTiktokCommentEvent } = await import('./comments')
  const { fitRuleToChannel } = await import('@/lib/comments/server')
  const { grantCredits } = await import('@/lib/billing/credits')
  const { saveChannelSecrets, loadChannel } = await import('@/lib/channels/store')
  const ws = await pg.workspace()
  const openId = `OPEN-${ws.workspaceId}`
  let channelId = ''
  const event = (commentId: string, over: Partial<TiktokCommentEvent> = {}): TiktokCommentEvent => ({
    openId, commentId, videoId: '7300000000000000002', parentId: null, type: 'comment', action: 'insert', authorId: `U-${commentId}`, text: 'precio', ...over,
  })

  beforeAll(async () => {
    await grantCredits({ workspaceId: ws.workspaceId, amount: 10, source: 'grant', expiresAt: new Date(Date.now() + 86400_000) })
    const c = await ws.db.channels.create({ data: { workspace_id: ws.workspaceId, type: 'tiktok', name: 'TikTok', external_id: openId }, select: { id: true } })
    channelId = c.id
    // Expired: the first call renews it.
    await saveChannelSecrets(channelId, { access_token: 'old-token', refresh_token: 'r1', token_expires_at: String(Date.now() - 1000) })
    await ws.db.comment_rules.create({
      data: { workspace_id: ws.workspaceId, channel_id: channelId, name: 'Precio', keywords: ['precio'], public_replies: ['¡Hola {nombre}! Cuesta S/ 50.'], private_message: null },
    })
  })
  afterAll(async () => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    await pg.cleanup(ws)
  })

  it('renews the token, finds who commented and replies in public with the exact ids', async () => {
    expect(await handleTiktokCommentEvent(event('7300000000000000001'))).toBe('replied')
    const reply = calls.find((c) => c.path === '/business/comment/reply/create/')!
    expect(reply.token).toBe('fresh-token')
    expect(reply.body).toEqual({ business_id: openId, video_id: '7300000000000000002', comment_id: '7300000000000000001', text: '¡Hola Ana! Cuesta S/ 50.' })
    const row = await ws.db.comment_replies.findFirstOrThrow({ where: { comment_id: '7300000000000000001' } })
    expect(row).toMatchObject({ status: 'replied', public_reply_id: '7300000000000000099', author_name: 'Ana Pérez', post_id: '7300000000000000002' })
    const ch = await loadChannel(ws.workspaceId, channelId)
    expect(ch?.secrets).toMatchObject({ access_token: 'fresh-token', refresh_token: 'r2' })
    expect(Number(ch?.secrets.token_expires_at)).toBeGreaterThan(Date.now() + 3_600_000)
  })

  it('ignores replies, deletions, unknown accounts and the account’s own comments', async () => {
    expect(await handleTiktokCommentEvent(event('7300000000000000003', { type: 'reply' }))).toBe('ignored')
    expect(await handleTiktokCommentEvent(event('7300000000000000004', { action: 'delete' }))).toBe('ignored')
    expect(await handleTiktokCommentEvent(event('7300000000000000005', { openId: 'someone-else' }))).toBe('ignored')
    fake.owner = true
    expect(await handleTiktokCommentEvent(event('7300000000000000006'))).toBe('ignored')
    fake.owner = false
    expect(await ws.db.comment_replies.count({ where: { channel_id: channelId } })).toBe(1)
  })

  it('a TikTok rule needs a public reply and never keeps a private message', async () => {
    const base = { channel_id: channelId, public_replies: [] as string[], private_message: 'Hola' }
    expect(await fitRuleToChannel(ws.workspaceId, base)).toEqual({ ok: false, error: 'reply_tiktok' })
    expect(await fitRuleToChannel(ws.workspaceId, { ...base, public_replies: ['x'.repeat(1201)] })).toEqual({ ok: false, error: 'too_long_tiktok' })
    expect(await fitRuleToChannel(ws.workspaceId, { ...base, public_replies: ['Hola'] })).toEqual({ ok: true, rule: { ...base, public_replies: ['Hola'], private_message: null } })
  })
})

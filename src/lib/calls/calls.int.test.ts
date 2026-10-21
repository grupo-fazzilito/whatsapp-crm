// WhatsApp calls end to end against a real Postgres, with the Calling API
// faked on fetch. TEST_DATABASE_URL=postgresql://crm:crm@127.0.0.1:5434/crm npx vitest run src/lib/calls
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { pgTest } from '@/lib/test-utils/pg'
import type { CallEvent } from './model'

vi.mock('server-only', () => ({}))
const pg = await pgTest()

const calls: { path: string; body: Record<string, unknown> | null }[] = []

describe.skipIf(!pg)('WhatsApp calls', async () => {
  if (!pg) return
  const realFetch = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (!href.startsWith('https://graph.facebook.com/')) return realFetch(input, init)
    const url = new URL(href)
    calls.push({ path: url.pathname, body: init?.body ? JSON.parse(String(init.body)) : null })
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } })
    if (url.searchParams.get('fields') === 'messaging_limit_tier') return json({ messaging_limit_tier: 'TIER_2K', id: 'x' })
    return json({ success: true, messaging_product: 'whatsapp' })
  })

  const { handleCallEvents, claimCall, answerStep, rejectCall, hangUp, setCalling, liveCalls } = await import('./server')
  const { saveChannelSecrets, loadChannel } = await import('@/lib/channels/store')
  const ws = await pg.workspace()
  const other = await pg.workspace()
  let channelId = ''
  const channel = async () => (await loadChannel(ws.workspaceId, channelId))!
  const channelOf = (id: string) => loadChannel(ws.workspaceId, id)
  const connect = (callId: string, phone = '51987000901'): CallEvent => ({
    kind: 'connect', phoneNumberId: 'x', callId, phone, userId: null, name: 'Ana', sdp: 'v=0 offer', timestamp: Date.now(),
  })
  const terminate = (callId: string, answered: boolean, duration: number | null = null): CallEvent => ({
    kind: 'terminate', phoneNumberId: 'x', callId, status: 'COMPLETED', durationSeconds: duration, answered, error: null, timestamp: Date.now(),
  })
  const row = (callId: string) => ws.db.whatsapp_calls.findFirstOrThrow({ where: { call_id: callId } })

  beforeAll(async () => {
    const c = await ws.db.channels.create({
      data: { workspace_id: ws.workspaceId, type: 'whatsapp', name: 'WA', external_id: `PN-CALL-${ws.workspaceId}` },
      select: { id: true },
    })
    channelId = c.id
    await saveChannelSecrets(channelId, { access_token: 'wa-token' })
  })
  beforeEach(() => {
    calls.length = 0
  })
  afterAll(async () => {
    vi.restoreAllMocks()
    await pg.cleanup(ws, other)
  })

  it('rings: a connect webhook creates the call with the contact and conversation, once', async () => {
    await handleCallEvents(await channel(), [connect('wacid.1')])
    await handleCallEvents(await channel(), [connect('wacid.1')]) // Meta retry
    expect(await ws.db.whatsapp_calls.count()).toBe(1)
    const c = await row('wacid.1')
    expect(c).toMatchObject({ status: 'ringing', sdp_offer: 'v=0 offer' })
    expect(c.contact_id && c.conversation_id).toBeTruthy()
    const live = await liveCalls(ws.workspaceId)
    expect(live).toHaveLength(1)
    expect(live[0]).not.toHaveProperty('sdp_offer')
    expect(live[0].contacts).toMatchObject({ name: 'Ana' })
  })

  it('the first agent to answer gets it; the call starts after pre_accept and accept', async () => {
    const c = await row('wacid.1')
    const first = await claimCall(ws.workspaceId, c.id, ws.userId)
    expect(first).toEqual({ ok: true, sdpOffer: 'v=0 offer' })
    expect(await claimCall(ws.workspaceId, c.id, other.userId)).toEqual({ ok: false, error: 'taken' })

    expect(await answerStep(ws.workspaceId, c.id, other.userId, 'pre_accept', 'v=0 answer', channelOf)).toEqual({ ok: false, error: 'not_yours' })
    expect(await answerStep(ws.workspaceId, c.id, ws.userId, 'pre_accept', 'v=0 answer', channelOf)).toEqual({ ok: true })
    expect(await answerStep(ws.workspaceId, c.id, ws.userId, 'accept', 'v=0 answer', channelOf)).toEqual({ ok: true })
    expect(calls.map((x) => x.body?.action)).toEqual(['pre_accept', 'accept'])
    expect(calls[0]).toMatchObject({ path: expect.stringMatching(/\/v24\.0\/PN-CALL-.*\/calls$/), body: { call_id: 'wacid.1', session: { sdp_type: 'answer', sdp: 'v=0 answer' } } })
    expect((await row('wacid.1')).status).toBe('in_progress')
  })

  it('the terminate webhook closes it with the duration and logs it in the conversation', async () => {
    await handleCallEvents(await channel(), [terminate('wacid.1', true, 125)])
    const c = await row('wacid.1')
    expect(c).toMatchObject({ status: 'completed', duration_seconds: 125, sdp_offer: null })
    const ev = await ws.db.conversation_events.findFirstOrThrow({ where: { conversation_id: c.conversation_id!, type: 'call' } })
    expect(ev).toMatchObject({ from_user: ws.userId, data: { status: 'completed', duration: 125 } })
    expect((await ws.db.conversations.findFirstOrThrow({ where: { id: c.conversation_id! } })).last_message_text).toBe('📞 Llamada · 2:05')
  })

  it('an unanswered call becomes a missed call and marks the conversation unread', async () => {
    await handleCallEvents(await channel(), [connect('wacid.2')])
    const before = await ws.db.conversations.findFirstOrThrow({ where: { id: (await row('wacid.2')).conversation_id! } })
    await handleCallEvents(await channel(), [terminate('wacid.2', false)])
    expect((await row('wacid.2')).status).toBe('missed')
    const after = await ws.db.conversations.findFirstOrThrow({ where: { id: before.id } })
    expect(after.unread_count).toBe((before.unread_count ?? 0) + 1)
    expect(after.last_message_text).toBe('📞 Llamada perdida')
  })

  it('reject tells WhatsApp and stays rejected after the terminate webhook', async () => {
    await handleCallEvents(await channel(), [connect('wacid.3')])
    const c = await row('wacid.3')
    expect(await rejectCall(ws.workspaceId, c.id, channelOf)).toEqual({ ok: true })
    expect(calls.at(-1)?.body).toMatchObject({ action: 'reject', call_id: 'wacid.3' })
    await handleCallEvents(await channel(), [terminate('wacid.3', false)])
    expect((await row('wacid.3')).status).toBe('rejected')
  })

  it('hanging up terminates the call and closes it even if the webhook is late', async () => {
    await handleCallEvents(await channel(), [connect('wacid.4')])
    const c = await row('wacid.4')
    await claimCall(ws.workspaceId, c.id, ws.userId)
    await answerStep(ws.workspaceId, c.id, ws.userId, 'accept', 'v=0 answer', channelOf)
    expect(await hangUp(ws.workspaceId, c.id, ws.userId, channelOf)).toEqual({ ok: true })
    expect(calls.at(-1)?.body).toMatchObject({ action: 'terminate', call_id: 'wacid.4' })
    expect((await row('wacid.4')).status).toBe('completed')
    // The late webhook doesn't log it twice.
    await handleCallEvents(await channel(), [terminate('wacid.4', true, 3)])
    expect(await ws.db.conversation_events.count({ where: { type: 'call', data: { path: ['call_id'], equals: 'wacid.4' } } })).toBe(1)
  })

  it("other workspaces can't see or take the call", async () => {
    await handleCallEvents(await channel(), [connect('wacid.5')])
    const c = await row('wacid.5')
    expect(await claimCall(other.workspaceId, c.id, other.userId)).toEqual({ ok: false, error: 'not_found' })
    expect(await liveCalls(other.workspaceId)).toEqual([])
  })

  it('turns calling on with the business hours, and refuses it on coexistence numbers', async () => {
    await ws.db.business_hours.create({ data: { workspace_id: ws.workspaceId, day_name: 'Monday', opening_time: '09:00', closing_time: '18:00' } })
    const r = await setCalling(await channel(), { enabled: true, useBusinessHours: true })
    expect(r).toMatchObject({ ok: true, state: { enabled: true, tier: 'TIER_2K', use_business_hours: true } })
    const settingsCall = calls.find((x) => x.path.endsWith('/settings'))
    expect(settingsCall?.body).toMatchObject({ calling: { status: 'ENABLED', call_hours: { status: 'ENABLED', weekly_operating_hours: [{ day_of_week: 'MONDAY', open_time: '0900', close_time: '1800' }] } } })

    const ch = await channel()
    ch.settings = { ...ch.settings, coexistence: true }
    expect(await setCalling(ch, { enabled: true, useBusinessHours: false })).toEqual({ ok: false, error: 'coexistence' })
  })
})

// WhatsApp calls answered by an AI agent, end to end against a real
// Postgres. Meta's Calling API and the voice service are faked on fetch.
// TEST_DATABASE_URL=postgresql://crm:crm@127.0.0.1:5434/crm npx vitest run src/lib/calls
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { pgTest } from '@/lib/test-utils/pg'
import type { CallEvent } from './model'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/ai/llm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ai/llm')>()),
  completeJson: vi.fn(async () => '{"summary":"Quería saber el horario y pidió hablar con una persona."}'),
}))
const pg = await pgTest()

const SECRET = 'voice-secret-0123456789abcdef'
const meta: { body: Record<string, unknown> | null }[] = []
const voice: { method: string; path: string; body: Record<string, unknown> | null }[] = []
let voiceFails = false

describe.skipIf(!pg)('WhatsApp calls answered by the AI', async () => {
  if (!pg) return
  process.env.VOICE_SERVICE_URL = 'http://voice.test'
  process.env.VOICE_SERVICE_SECRET = SECRET
  process.env.VOICE_CALLBACK_URL = 'http://app.test'
  process.env.OPENAI_REALTIME_API_KEY = 'sk-test-realtime'

  const realFetch = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } })
    if (href.startsWith('https://graph.facebook.com/')) {
      meta.push({ body: init?.body ? JSON.parse(String(init.body)) : null })
      return json({ success: true })
    }
    if (href.startsWith('http://voice.test/')) {
      const url = new URL(href)
      voice.push({ method: init?.method ?? 'GET', path: url.pathname, body: init?.body ? JSON.parse(String(init.body)) : null })
      expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${SECRET}`)
      if (voiceFails) return json({ error: 'boom' }, 502)
      return json(init?.method === 'POST' ? { sdp: 'v=0 ai-answer' } : { ok: true })
    }
    return realFetch(input, init)
  })

  const { handleCallEvents, setCallAi } = await import('./server')
  const { runVoiceTool, finishAiCall } = await import('./ai')
  const { saveChannelSecrets, loadChannel } = await import('@/lib/channels/store')
  const { grantCredits, creditBalance } = await import('@/lib/billing/credits')
  const ws = await pg.workspace({ name: 'Peluquería Sol' })
  let channelId = ''
  let agentId = ''
  const channel = async () => (await loadChannel(ws.workspaceId, channelId))!
  const connect = (callId: string): CallEvent => ({
    kind: 'connect', phoneNumberId: 'x', callId, phone: '51987000777', userId: null, name: 'Luis', sdp: 'v=0 offer', timestamp: Date.now(),
  })
  const terminate = (callId: string, duration: number): CallEvent => ({
    kind: 'terminate', phoneNumberId: 'x', callId, status: 'COMPLETED', durationSeconds: duration, answered: true, error: null, timestamp: Date.now(),
  })
  const row = (callId: string) => ws.db.whatsapp_calls.findFirstOrThrow({ where: { call_id: callId } })

  beforeAll(async () => {
    const c = await ws.db.channels.create({
      data: { workspace_id: ws.workspaceId, type: 'whatsapp', name: 'WA', external_id: `PN-AI-${ws.workspaceId}` },
      select: { id: true },
    })
    channelId = c.id
    await saveChannelSecrets(channelId, { access_token: 'wa-token' })
    const agent = await ws.db.ai_agents.create({ data: { workspace_id: ws.workspaceId, name: 'Sofía', skills: ['faq', 'handover'], enabled: true } })
    agentId = agent.id
    await grantCredits({ workspaceId: ws.workspaceId, amount: 1000, source: 'grant', expiresAt: new Date(Date.now() + 86_400_000), note: 'test' })
  })
  beforeEach(() => {
    meta.length = 0
    voice.length = 0
    voiceFails = false
  })
  afterAll(async () => {
    vi.restoreAllMocks()
    await pg.cleanup(ws)
  })

  it('"Solo personas": the AI never picks up', async () => {
    await setCallAi(await channel(), { mode: 'humans', agent_id: agentId })
    await handleCallEvents(await channel(), [connect('wacid.h1')])
    expect((await row('wacid.h1')).status).toBe('ringing')
    expect(voice).toHaveLength(0)
  })

  it('"Solo IA": the voice service answers and the call starts with its SDP', async () => {
    await setCallAi(await channel(), { mode: 'ai', agent_id: agentId, voice: 'cedar', max_minutes: 5, greeting: 'Hola, {business} al habla' })
    await handleCallEvents(await channel(), [connect('wacid.a1')])
    const c = await row('wacid.a1')
    expect(c).toMatchObject({ status: 'in_progress', ai_agent_id: agentId, answered_by: null })
    expect(meta.map((m) => m.body?.action)).toEqual(['pre_accept', 'accept'])
    expect(meta[0].body).toMatchObject({ session: { sdp_type: 'answer', sdp: 'v=0 ai-answer' } })

    const start = voice[0]
    expect(start).toMatchObject({ method: 'POST', path: '/calls' })
    expect(start.body).toMatchObject({
      call: c.id,
      sdp: 'v=0 offer',
      api_key: 'sk-test-realtime',
      voice: 'cedar',
      max_seconds: 300,
      greeting: 'Hola, Peluquería Sol al habla',
      callback_url: `http://app.test/api/voice/calls/${c.id}`,
    })
    expect(String(start.body?.instructions)).toContain('Peluquería Sol')
    expect(String(start.body?.instructions)).toContain('Luis')
    const tools = (start.body?.tools as { name: string }[]).map((t) => t.name)
    expect(tools).toEqual(['transfer_to_human', 'end_call']) // no bookings/catalog skills
    expect(start.body?.protected_names).toEqual(expect.arrayContaining(['Peluquería Sol', 'Sofía']))
  })

  it('transfer_to_human hands the chat to the team and leaves a task', async () => {
    const c = await row('wacid.a1')
    const out = await runVoiceTool(c.id, 'transfer_to_human', { reason: 'Quiere hablar con la dueña' })
    expect(out).toMatchObject({ ok: true })
    const task = await ws.db.tasks.findFirstOrThrow({ where: { conversation_id: c.conversation_id! } })
    expect(task).toMatchObject({ title: 'Devolver la llamada', description: 'Quiere hablar con la dueña', priority: 'high' })
    const conv = await ws.db.conversations.findFirstOrThrow({ where: { id: c.conversation_id! } })
    expect(conv.ai_paused_until).toBeTruthy()
    expect(await runVoiceTool(c.id, 'nope', {})).toMatchObject({ error: expect.any(String) })
  })

  it('the end callback stores the transcript, a summary note, and hangs up when the AI ended it', async () => {
    const c = await row('wacid.a1')
    const transcript = [
      { role: 'assistant', text: 'Hola, Peluquería Sol al habla', at: null },
      { role: 'user', text: 'Hola, ¿a qué hora abren?', at: null },
      { role: 'system', text: 'ignored', at: null },
    ]
    await finishAiCall(c.id, { transcript, hangup: true, reason: 'ai_ended' }, (id) => loadChannel(ws.workspaceId, id))
    await finishAiCall(c.id, { transcript, hangup: false, reason: 'retry' }, (id) => loadChannel(ws.workspaceId, id)) // retried
    expect(meta.map((m) => m.body?.action)).toEqual(['terminate'])
    const after = await row('wacid.a1')
    expect(after.ai_transcript).toHaveLength(2)
    expect(after.ai_summary).toContain('horario')
    const notes = await ws.db.messages.findMany({ where: { conversation_id: c.conversation_id!, is_internal: true } })
    expect(notes).toHaveLength(1)
    expect(notes[0].content_text).toContain('Llamada atendida por Sofía (IA)')
    expect(notes[0].content_text).toContain('Cliente: Hola, ¿a qué hora abren?')
  })

  it("Meta's terminate closes it, stops the voice service and bills every started minute once", async () => {
    const before = await creditBalance(ws.workspaceId)
    await handleCallEvents(await channel(), [terminate('wacid.a1', 61)])
    await handleCallEvents(await channel(), [terminate('wacid.a1', 61)]) // retried webhook
    const c = await row('wacid.a1')
    expect(c).toMatchObject({ status: 'completed', duration_seconds: 61 })
    expect(c.billed_at).toBeTruthy()
    expect(await creditBalance(ws.workspaceId)).toBe(before - 100) // 2 min × 50
    expect(voice).toEqual([{ method: 'DELETE', path: `/calls/${c.id}`, body: null }])
    const ev = await ws.db.conversation_events.findFirstOrThrow({ where: { conversation_id: c.conversation_id!, type: 'call' }, orderBy: { created_at: 'desc' } })
    expect(ev.data).toMatchObject({ status: 'completed', ai_agent_id: agentId, ai_agent_name: 'Sofía' })
  })

  it('if the voice service fails, the call goes back to ringing for the team', async () => {
    voiceFails = true
    await handleCallEvents(await channel(), [connect('wacid.a2')])
    expect(await row('wacid.a2')).toMatchObject({ status: 'ringing', ai_agent_id: null })
    expect(meta).toHaveLength(0)
  })

  it('a disabled agent never answers', async () => {
    await ws.db.ai_agents.updateMany({ where: { id: agentId }, data: { enabled: false } })
    await handleCallEvents(await channel(), [connect('wacid.a3')])
    expect((await row('wacid.a3')).status).toBe('ringing')
    expect(voice).toHaveLength(0)
  })

  it('rejects voice callbacks without the secret', async () => {
    const { voiceAuthorized } = await import('./ai-session')
    expect(voiceAuthorized(new Request('http://x', { headers: { Authorization: `Bearer ${SECRET}` } }))).toBe(true)
    expect(voiceAuthorized(new Request('http://x', { headers: { Authorization: 'Bearer wrong' } }))).toBe(false)
    expect(voiceAuthorized(new Request('http://x'))).toBe(false)
  })
})

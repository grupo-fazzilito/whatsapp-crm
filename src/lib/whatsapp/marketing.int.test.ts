// Marketing templates through the Marketing Messages API, against a real
// Postgres with the Graph API faked on fetch.
// TEST_DATABASE_URL=postgresql://crm:crm@127.0.0.1:5434/crm npx vitest run src/lib/whatsapp/marketing
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { pgTest } from '@/lib/test-utils/pg'

vi.mock('server-only', () => ({}))
const pg = await pgTest()

const calls: { path: string; method: string }[] = []
const meta = { status: 'ELIGIBLE', mmFails: false }

describe.skipIf(!pg)('Marketing Messages API', async () => {
  if (!pg) return
  const realFetch = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (!href.startsWith('https://graph.facebook.com/')) return realFetch(input, init)
    const url = new URL(href)
    calls.push({ path: url.pathname, method: init?.method ?? 'GET' })
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } })
    if (url.pathname.endsWith('/WABA-MM')) return json({ marketing_messages_onboarding_status: meta.status, id: 'WABA-MM' })
    if (url.pathname.endsWith('/marketing_messages')) {
      if (meta.mmFails) return json({ error: { message: 'Marketing Messages API unavailable', code: 100 } }, 400)
      return json({ messages: [{ id: `wamid.mm${calls.length}` }] })
    }
    if (url.pathname.endsWith('/messages')) return json({ messages: [{ id: `wamid.cloud${calls.length}` }] })
    return json({ error: { message: 'unhandled' } }, 404)
  })

  const { sendMessage } = await import('@/lib/messaging/send')
  const { saveChannelSecrets } = await import('@/lib/channels/store')
  const { applyMarketingTermsSigned } = await import('./marketing-server')
  const ws = await pg.workspace()
  let channelId = ''
  let conversationId = ''
  const send = (templateName: string) =>
    sendMessage({ workspaceId: ws.workspaceId, conversationId, content: { type: 'template', templateName, language: 'es' }, sender: { type: 'agent' } })
  const sends = () => calls.filter((c) => c.method === 'POST').map((c) => c.path.split('/').pop())

  beforeAll(async () => {
    const c = await ws.db.channels.create({
      data: { workspace_id: ws.workspaceId, type: 'whatsapp', name: 'WA', external_id: `PN-MM-${ws.workspaceId}`, settings: { waba_id: 'WABA-MM' } },
      select: { id: true },
    })
    channelId = c.id
    await saveChannelSecrets(channelId, { access_token: 'wa-token' })
    const contact = await ws.db.contacts.create({ data: { workspace_id: ws.workspaceId, name: 'Ana', phone: '51987000555' }, select: { id: true } })
    const conv = await ws.db.conversations.create({ data: { workspace_id: ws.workspaceId, contact_id: contact.id, channel_id: channelId }, select: { id: true } })
    conversationId = conv.id
    await ws.db.message_templates.createMany({
      data: [
        { workspace_id: ws.workspaceId, name: 'promo_octubre', language: 'es', category: 'Marketing', body_text: 'Promo', status: 'Approved' },
        { workspace_id: ws.workspaceId, name: 'pedido_listo', language: 'es', category: 'Utility', body_text: 'Listo', status: 'Approved' },
      ],
    })
  })
  beforeEach(() => {
    calls.length = 0
  })
  afterAll(async () => {
    vi.restoreAllMocks()
    await pg.cleanup(ws)
  })

  it('sends through Cloud API while the business has not accepted the terms, and remembers the check', async () => {
    expect((await send('promo_octubre')).status).toBe('sent')
    expect(calls.map((c) => c.path.split('/').pop())).toEqual(['WABA-MM', 'messages'])
    const row = await ws.db.channels.findFirstOrThrow({ where: { id: channelId } })
    expect((row.settings as Record<string, { status: string }>).marketing_messages.status).toBe('ELIGIBLE')

    // Checked a moment ago: not asked again on the next send.
    await send('promo_octubre')
    expect(calls.map((c) => c.path.split('/').pop())).toEqual(['WABA-MM', 'messages', 'messages'])
  })

  it('switches to the Marketing Messages API once the terms-signed webhook arrives', async () => {
    meta.status = 'ONBOARDED'
    await applyMarketingTermsSigned(['WABA-MM'])
    calls.length = 0
    const res = await send('promo_octubre')
    expect(res.status).toBe('sent')
    expect(sends()).toEqual(['marketing_messages'])
    expect(calls[0].path).toMatch(/^\/v24\.0\//)
  })

  it('keeps utility templates on Cloud API', async () => {
    await send('pedido_listo')
    expect(sends()).toEqual(['messages'])
  })

  it('falls back to Cloud API if the Marketing Messages API refuses', async () => {
    meta.mmFails = true
    const res = await send('promo_octubre')
    expect(res.status).toBe('sent')
    expect(sends()).toEqual(['marketing_messages', 'messages'])
    meta.mmFails = false
  })
})

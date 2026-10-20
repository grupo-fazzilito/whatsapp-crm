// WhatsApp customers known by their business-scoped user id (BSUID) instead
// of their phone, against a real Postgres with the Cloud API faked on fetch.
// TEST_DATABASE_URL=postgresql://crm:crm@127.0.0.1:5434/crm npx vitest run src/lib/messaging/bsuid
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { pgTest } from '@/lib/test-utils/pg'

vi.mock('server-only', () => ({}))
const pg = await pgTest()

const sent: Record<string, unknown>[] = []

describe.skipIf(!pg)('WhatsApp BSUIDs', async () => {
  if (!pg) return
  const realFetch = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (!href.startsWith('https://graph.facebook.com/')) return realFetch(input, init)
    const body = JSON.parse(String(init?.body ?? '{}'))
    sent.push(body)
    return new Response(JSON.stringify({ messages: [{ id: `wamid.out${sent.length}` }] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  })

  const { findOrCreateContact, ingestEvents } = await import('./ingest')
  const { sendMessage } = await import('./send')
  const { saveChannelSecrets, loadChannel } = await import('@/lib/channels/store')
  const ws = await pg.workspace()
  let channelId = ''
  const channel = async () => (await loadChannel(ws.workspaceId, channelId))!
  const identitiesOf = async (contactId: string) =>
    (await ws.db.contact_identities.findMany({ where: { contact_id: contactId }, select: { external_id: true } })).map((i) => i.external_id).sort()

  beforeAll(async () => {
    const c = await ws.db.channels.create({
      data: { workspace_id: ws.workspaceId, type: 'whatsapp', name: 'WA', external_id: `PN-BSUID-${ws.workspaceId}` },
      select: { id: true },
    })
    channelId = c.id
    await saveChannelSecrets(channelId, { access_token: 'wa-token' })
  })
  afterAll(async () => {
    vi.restoreAllMocks()
    await pg.cleanup(ws)
  })

  it('creates a contact without phone from a BSUID and answers it by BSUID', async () => {
    const ch = await channel()
    const c = await findOrCreateContact(ch, { externalId: 'PE.111', userId: 'PE.111', phone: null, handle: '@sheena', name: 'Sheena' })
    expect(c?.wasCreated).toBe(true)
    expect(await ws.db.contacts.findFirstOrThrow({ where: { id: c!.id } })).toMatchObject({ phone: null, name: 'Sheena' })
    expect(await identitiesOf(c!.id)).toEqual(['PE.111'])

    const conv = await ws.db.conversations.create({ data: { workspace_id: ws.workspaceId, contact_id: c!.id, channel_id: channelId }, select: { id: true } })
    await sendMessage({ workspaceId: ws.workspaceId, conversationId: conv.id, content: { type: 'text', text: 'Hola' }, sender: { type: 'agent' } })
    expect(sent.at(-1)).toMatchObject({ recipient: 'PE.111', type: 'text' })
    expect(sent.at(-1)).not.toHaveProperty('to')
    // The BSUID never ends up as the contact's phone.
    expect((await ws.db.contacts.findFirstOrThrow({ where: { id: c!.id } })).phone).toBeNull()
  })

  it('links the phone to the same contact once Meta shares it, and then writes to the phone', async () => {
    const ch = await channel()
    const c = await findOrCreateContact(ch, { externalId: '51987000111', userId: 'PE.111', phone: '51987000111', handle: '51987000111' })
    const first = await ws.db.contact_identities.findFirstOrThrow({ where: { external_id: 'PE.111' } })
    expect(c).toEqual({ id: first.contact_id, wasCreated: false })
    expect(await identitiesOf(c!.id)).toEqual(['51987000111', 'PE.111'])
    expect((await ws.db.contacts.findFirstOrThrow({ where: { id: c!.id } })).phone).toBe('51987000111')

    const conv = await ws.db.conversations.findFirstOrThrow({ where: { contact_id: c!.id } })
    await sendMessage({ workspaceId: ws.workspaceId, conversationId: conv.id, content: { type: 'text', text: 'Hola' }, sender: { type: 'agent' } })
    expect(sent.at(-1)).toMatchObject({ to: '51987000111' })
    expect(sent.at(-1)).not.toHaveProperty('recipient')
  })

  it('adds the BSUID to a contact first known by phone', async () => {
    const ch = await channel()
    const byPhone = await findOrCreateContact(ch, { externalId: '51987000222', phone: '51987000222' })
    const again = await findOrCreateContact(ch, { externalId: '51987000222', userId: 'PE.222', phone: '51987000222' })
    expect(again?.id).toBe(byPhone?.id)
    expect(await identitiesOf(byPhone!.id)).toEqual(['51987000222', 'PE.222'])
    // A later message with the BSUID alone finds the same person.
    const bsuidOnly = await findOrCreateContact(ch, { externalId: 'PE.222', userId: 'PE.222', phone: null })
    expect(bsuidOnly).toEqual({ id: byPhone!.id, wasCreated: false })
  })

  it('follows number and BSUID changes without losing the contact', async () => {
    const ch = await channel()
    const c = await findOrCreateContact(ch, { externalId: '51987000333', userId: 'PE.333', phone: '51987000333' })
    await ingestEvents(ch, [
      { kind: 'identity_change', channelExternalId: ch.external_id, previous: { phone: '51987000333', userId: 'PE.333' }, current: { phone: '51987000444', userId: 'PE.334' }, timestamp: Date.now() },
    ])
    expect(await identitiesOf(c!.id)).toEqual(['51987000444', 'PE.334'])
    expect((await ws.db.contacts.findFirstOrThrow({ where: { id: c!.id } })).phone).toBe('+51987000444')

    await ingestEvents(ch, [
      { kind: 'identity_change', channelExternalId: ch.external_id, previous: { phone: null, userId: 'PE.334' }, current: { phone: null, userId: 'PE.335' }, timestamp: Date.now() },
    ])
    expect(await identitiesOf(c!.id)).toEqual(['51987000444', 'PE.335'])
  })
})

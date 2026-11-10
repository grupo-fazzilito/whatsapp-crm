// A conversation keeps the network / account it came from (migration 31):
// deleting its channel no longer turns it into a WhatsApp chat.
// TEST_DATABASE_URL=postgresql://crm:crm@127.0.0.1:5434/crm_migrated npx vitest run src/lib/messaging/channel-origin
import { afterAll, describe, expect, it, vi } from 'vitest'
import { pgTest } from '@/lib/test-utils/pg'

vi.mock('server-only', () => ({}))
const pg = await pgTest()

describe.skipIf(!pg)('conversation channel origin', async () => {
  if (!pg) return
  const { loadChannel } = await import('@/lib/channels/store')
  const { findOrCreateConversation } = await import('./ingest')
  const { findOrCreateConversationOnChannel } = await import('./conversations')
  const { sendMessage } = await import('./send')
  const ws = await pg.workspace()
  const W = ws.workspaceId
  afterAll(() => pg.cleanup(ws))

  const channel = (type: string, name: string, external_id: string) =>
    ws.db.channels.create({ data: { workspace_id: W, type, name, external_id } })

  it('keeps the origin when the channel is deleted and returns to the same account', async () => {
    const page = await channel('messenger', 'Página X', 'PAGE1')
    const contact = await ws.db.contacts.create({ data: { workspace_id: W, name: 'Ana' } })
    const conv = await ws.db.conversations.create({ data: { workspace_id: W, contact_id: contact.id, channel_id: page.id } })
    expect(conv).toMatchObject({ channel_type: 'messenger', channel_account_id: 'PAGE1', channel_name: 'Página X' })

    await ws.db.channels.updateMany({ where: { id: page.id }, data: { name: 'Página X nueva' } })
    await ws.db.channels.deleteMany({ where: { id: page.id } })
    expect(await ws.db.conversations.findFirst({ where: { id: conv.id } })).toMatchObject({
      channel_id: null, channel_type: 'messenger', channel_account_id: 'PAGE1', channel_name: 'Página X nueva',
    })

    await channel('messenger', 'Otra', 'PAGE2')
    expect((await ws.db.conversations.findFirst({ where: { id: conv.id } }))?.channel_id).toBeNull()

    const again = await channel('messenger', 'Página X', 'PAGE1')
    expect((await ws.db.conversations.findFirst({ where: { id: conv.id } }))?.channel_id).toBe(again.id)
  })

  it('never turns an Instagram chat into WhatsApp, nor replies through WhatsApp', async () => {
    const ig = await channel('instagram', '@tienda', 'IG1')
    const wa = await channel('whatsapp', 'Ventas', 'PN1')
    const contact = await ws.db.contacts.create({ data: { workspace_id: W, name: 'Luis', phone: '+51987654321' } })
    await ws.db.contact_identities.create({ data: { workspace_id: W, contact_id: contact.id, channel_type: 'instagram', external_id: 'IGSID1' } })
    const conv = await ws.db.conversations.create({ data: { workspace_id: W, contact_id: contact.id, channel_id: ig.id } })
    await ws.db.channels.deleteMany({ where: { id: ig.id } })

    const waConv = await findOrCreateConversationOnChannel((await loadChannel(W, wa.id))!, contact.id)
    expect(waConv).not.toBe(conv.id)
    expect(await ws.db.conversations.findFirst({ where: { id: conv.id } })).toMatchObject({ channel_id: null, channel_type: 'instagram' })

    const sent = await sendMessage({ workspaceId: W, conversationId: conv.id, content: { type: 'text', text: 'hola' }, sender: { type: 'agent' } })
    expect(sent.status).toBe('failed')

    // The customer writes to the Instagram account connected now (their id matched): same chat.
    const ig2 = await channel('instagram', '@tienda', 'IG2')
    const got = await findOrCreateConversation((await loadChannel(W, ig2.id))!, contact.id)
    expect(got?.id).toBe(conv.id)
    expect(got?.channel_id).toBe(ig2.id)
  })
})

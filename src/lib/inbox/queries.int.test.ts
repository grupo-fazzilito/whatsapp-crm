// Inbox / agents / broadcast data access behind the browser API routes,
// against a real PostgreSQL:
//   TEST_DATABASE_URL=postgresql://crm:crm@127.0.0.1:5434/crm npx vitest run src/lib/inbox
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { pgTest } from '@/lib/test-utils/pg'

vi.mock('server-only', () => ({}))

const pg = await pgTest()

describe.skipIf(!pg)('browser data routes on PostgreSQL', async () => {
  if (!pg) return
  const { prisma, workspace, cleanup } = pg
  const q = await import('./queries')
  const agents = await import('@/lib/ai/agents-store')
  const bc = await import('@/lib/broadcasts/audience')
  let a: Awaited<ReturnType<typeof workspace>>
  let b: Awaited<ReturnType<typeof workspace>>
  let contactId: string
  let convId: string
  let otherConvId: string
  let tagId: string

  beforeAll(async () => {
    a = await workspace({ name: 'Inbox A' })
    b = await workspace({ name: 'Inbox B' })
    const contact = await a.db.contacts.create({ data: { workspace_id: a.workspaceId, name: 'Ana', phone: '+5491100000001' } })
    contactId = contact.id
    const tag = await a.db.tags.create({ data: { workspace_id: a.workspaceId, name: 'vip' } })
    tagId = tag.id
    await a.db.contact_tags.create({ data: { workspace_id: a.workspaceId, contact_id: contactId, tag_id: tagId } })
    const conv = await a.db.conversations.create({
      data: { workspace_id: a.workspaceId, contact_id: contactId, unread_count: 3, last_message_at: new Date() },
    })
    convId = conv.id
    await a.db.conversation_tags.create({ data: { workspace_id: a.workspaceId, conversation_id: convId, tag_id: tagId } })
    await a.db.messages.createMany({
      data: [
        { workspace_id: a.workspaceId, conversation_id: convId, sender_type: 'customer', content_text: 'hola' },
        { workspace_id: a.workspaceId, conversation_id: convId, sender_type: 'agent', content_type: 'image', media_url: '/api/files/attachments/x/a.jpg' },
        { workspace_id: a.workspaceId, conversation_id: convId, sender_type: 'agent', content_text: 'oops', status: 'failed' },
      ],
    })
    const otherContact = await b.db.contacts.create({ data: { workspace_id: b.workspaceId, name: 'Beto', phone: '+5491100000002' } })
    const other = await b.db.conversations.create({ data: { workspace_id: b.workspaceId, contact_id: otherContact.id, unread_count: 5 } })
    otherConvId = other.id
  })
  afterAll(async () => {
    await cleanup(a, b)
    await prisma.$disconnect()
  })

  it('lists conversations in the inbox row shape, only of the workspace', async () => {
    const rows = await q.listInboxConversations(a.db)
    expect(rows.map((r) => r.id)).toEqual([convId])
    const row = rows[0] as Record<string, unknown> & { contact: { name: string; contact_tags: { tag_id: string }[] }; conversation_tags: { id: string; tag_id: string }[] }
    expect(row.contact.name).toBe('Ana')
    expect(row.contact.contact_tags).toEqual([{ tag_id: tagId }])
    expect(row.conversation_tags[0].tag_id).toBe(tagId)
    expect(typeof row.last_message_at).toBe('string')
    expect('contacts' in row).toBe(false)
    expect(await q.listInboxConversations(a.db, { id: otherConvId })).toEqual([])
  })

  it('messages, files and unread counters stay inside the workspace', async () => {
    expect((await q.listMessages(a.db, convId)).map((m) => m.content_text)).toEqual(['hola', null, 'oops'])
    expect(await q.listMessages(a.db, otherConvId)).toEqual([])
    const files = await q.listConversationFiles(a.db, convId)
    expect(files).toHaveLength(1)
    expect(files[0].content_type).toBe('image')

    expect(await q.markConversationRead(a.db, otherConvId)).toBe(false)
    expect((await prisma.conversations.findUniqueOrThrow({ where: { id: otherConvId } })).unread_count).toBe(5)
    expect(await q.markConversationRead(a.db, convId)).toBe(true)
    expect(await q.listUnreadCounts(a.db)).toMatchObject([{ id: convId, unread_count: 0, status: "open", needs_human_since: null }])
  })

  it('only failed messages can be deleted', async () => {
    const msgs = await q.listMessages(a.db, convId)
    const ok = msgs.find((m) => m.status !== 'failed')!
    const failed = msgs.find((m) => m.status === 'failed')!
    expect(await q.deleteFailedMessage(a.db, ok.id)).toBe(false)
    expect(await q.deleteFailedMessage(b.db, failed.id)).toBe(false)
    expect(await q.deleteFailedMessage(a.db, failed.id)).toBe(true)
  })

  it('contact panel and notes refuse contacts of another workspace', async () => {
    const note = await q.addContactNote(a.db, a.workspaceId, a.userId, contactId, 'llamar mañana')
    expect(note?.user_id).toBe(a.userId)
    const panel = await q.contactPanel(a.db, contactId)
    expect(panel?.notes.map((n) => n.note_text)).toEqual(['llamar mañana'])
    expect(panel?.tags[0].tags?.name).toBe('vip')
    expect(await q.contactPanel(b.db, contactId)).toBeNull()
    expect(await q.addContactNote(b.db, b.workspaceId, b.userId, contactId, 'x')).toBeNull()
    expect(await q.contactOrders(a.db, contactId)).toEqual({ orders: [], cart: null })
  })

  it('directory lists active members with their profile', async () => {
    const dir = await q.inboxDirectory(a.db)
    expect(dir.members.map((m) => m.user_id)).toEqual([a.userId])
    expect((await q.activeMemberNames(a.db)).map((m) => m.user_id)).toEqual([a.userId])
  })

  it('agents: create, transfer targets limited to the workspace, update, delete', async () => {
    const foreign = await agents.createAgent(b.db, b.workspaceId, b.userId, { name: 'Foreign' })
    const first = await agents.createAgent(a.db, a.workspaceId, a.userId, { name: 'Router', skills: ['router'] })
    const second = await agents.createAgent(a.db, a.workspaceId, a.userId, {
      name: 'Sales',
      transfer_agent_ids: [first.id, foreign.id],
    })
    expect(second.transfer_agent_ids).toEqual([first.id])
    expect(second.created_by).toBe(a.userId)
    expect(await agents.updateAgent(b.db, second.id, { enabled: false })).toBeNull()
    expect((await agents.updateAgent(a.db, second.id, { enabled: false }))?.enabled).toBe(false)
    const listed = await agents.listAgentsWithChannels(a.db)
    expect(listed.agents.map((x) => x.name)).toEqual(['Router', 'Sales'])
    expect(await agents.deleteAgent(b.db, first.id)).toBe(false)
    expect(await agents.deleteAgent(a.db, first.id)).toBe(true)
  })

  it('broadcast audience: estimate, prepare and progress', async () => {
    expect(await bc.estimateAudience(a.db, { type: 'all' })).toBe(1)
    expect(await bc.estimateAudience(a.db, { type: 'tags', tagIds: [tagId] })).toBe(1)
    expect(await bc.estimateAudience(a.db, { type: 'all', excludeTagIds: [tagId] })).toBe(0)
    expect(await bc.estimateAudience(a.db, { type: 'tags', tagIds: [] })).toBeNull()
    // Another workspace's tag matches nothing.
    expect(await bc.estimateAudience(b.db, { type: 'tags', tagIds: [tagId] })).toBe(0)

    const field = await a.db.custom_fields.create({ data: { workspace_id: a.workspaceId, field_name: 'city', field_type: 'text' } })
    await a.db.contact_custom_values.create({ data: { workspace_id: a.workspaceId, contact_id: contactId, custom_field_id: field.id, value: 'Rosario' } })
    expect(await bc.estimateAudience(a.db, { type: 'custom_field', customField: { fieldId: field.id, operator: 'contains', value: 'ros' } })).toBe(1)
    expect(await bc.estimateAudience(a.db, { type: 'custom_field', customField: { fieldId: field.id, operator: 'is_not', value: 'Rosario' } })).toBe(0)

    const prepared = await bc.prepareBroadcast(a.db, a.workspaceId, a.userId, {
      name: 'Promo',
      templateName: 'promo',
      templateLanguage: 'es',
      variables: { '1': { type: 'field', value: 'name' } },
      audience: { type: 'csv', csvContacts: [{ phone: '+5491100000001' }, { phone: '+5491100000009', name: 'Nuevo' }] },
    })
    expect(prepared.broadcast.status).toBe('sending')
    expect(prepared.recipients).toHaveLength(2)
    expect(prepared.recipients.map((r) => r.contact?.phone).sort()).toEqual(['+5491100000001', '+5491100000009'])
    expect(prepared.customValues[contactId]).toEqual({ [field.id]: 'Rosario' })
    expect(await a.db.contacts.count()).toBe(2)

    const [r1, r2] = prepared.recipients
    expect(await bc.recordBroadcastProgress(b.db, prepared.broadcast.id, [{ id: r1.id, status: 'sent' }])).toBe(false)
    expect(
      await bc.recordBroadcastProgress(a.db, prepared.broadcast.id, [
        { id: r1.id, status: 'sent', whatsapp_message_id: 'wamid.1' },
        { id: r2.id, status: 'failed', error_message: 'bad number' },
      ], 'sent'),
    ).toBe(true)
    const rows = await a.db.broadcast_recipients.findMany({ where: { broadcast_id: prepared.broadcast.id }, orderBy: { status: 'asc' } })
    expect(rows.map((r) => [r.status, r.whatsapp_message_id, r.error_message])).toEqual([
      ['failed', null, 'bad number'],
      ['sent', 'wamid.1', null],
    ])
    expect((await a.db.broadcasts.findFirstOrThrow({ where: { id: prepared.broadcast.id } })).status).toBe('sent')

    await expect(
      bc.prepareBroadcast(a.db, a.workspaceId, a.userId, { name: 'x', templateName: 't', templateLanguage: 'es', variables: {}, audience: { type: 'tags', tagIds: [] } }),
    ).rejects.toBeInstanceOf(bc.EmptyAudienceError)
  })
})

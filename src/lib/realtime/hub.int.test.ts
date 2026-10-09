// TEST_DATABASE_URL=postgresql://crm:crm@127.0.0.1:5434/crm npx vitest run src/lib/realtime
import { afterAll, describe, expect, it, vi } from 'vitest'
import { pgTest } from '@/lib/test-utils/pg'
import type { RealtimeChange } from './types'

vi.mock('server-only', () => ({}))
const pg = await pgTest()

const waitFor = async (pred: () => boolean, ms = 5000) => {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (pred()) return true
    await new Promise((r) => setTimeout(r, 50))
  }
  return pred()
}

describe.skipIf(!pg)('realtime hub on PostgreSQL', async () => {
  if (!pg) return
  const { subscribe } = await import('./hub')
  const a = await pg.workspace({ name: 'RT A' })
  const b = await pg.workspace({ name: 'RT B' })
  afterAll(() => pg.cleanup(a, b))

  it('delivers row changes to the same workspace only, with the full row', async () => {
    const gotA: RealtimeChange[] = []
    const gotB: RealtimeChange[] = []
    const offA = await subscribe({ workspaceId: a.workspaceId, userId: a.userId, send: (c) => gotA.push(c) })
    const offB = await subscribe({ workspaceId: b.workspaceId, userId: b.userId, send: (c) => gotB.push(c) })
    const contact = await a.db.contacts.create({ data: { workspace_id: a.workspaceId, name: 'Ana', phone: '+51999111222' } })
    const conv = await a.db.conversations.create({ data: { workspace_id: a.workspaceId, contact_id: contact.id } })
    const msg = await a.db.messages.create({ data: { workspace_id: a.workspaceId, conversation_id: conv.id, sender_type: 'customer', content_type: 'text', content_text: 'hola', status: 'delivered' } })
    expect(await waitFor(() => gotA.some((c) => c.table === 'messages' && c.eventType === 'INSERT'))).toBe(true)
    const ev = gotA.find((c) => c.table === 'messages')!
    expect(ev.new).toMatchObject({ id: msg.id, content_text: 'hola', conversation_id: conv.id })
    expect(typeof (ev.new as { created_at: unknown }).created_at).toBe('string')
    await a.db.messages.deleteMany({ where: { id: msg.id } })
    expect(await waitFor(() => gotA.some((c) => c.table === 'messages' && c.eventType === 'DELETE'))).toBe(true)
    expect(gotA.find((c) => c.eventType === 'DELETE')!.old).toMatchObject({ id: msg.id, conversation_id: conv.id })
    expect(gotB).toHaveLength(0)
    offA()
    offB()
  })

  it('notifications reach only their recipient', async () => {
    const mine: RealtimeChange[] = []
    const other: RealtimeChange[] = []
    const offMine = await subscribe({ workspaceId: a.workspaceId, userId: a.userId, send: (c) => mine.push(c) })
    const offOther = await subscribe({ workspaceId: a.workspaceId, userId: '00000000-0000-0000-0000-000000000000', send: (c) => other.push(c) })
    await a.db.notifications.create({ data: { workspace_id: a.workspaceId, user_id: a.userId, type: 'system', title: 'hi' } })
    expect(await waitFor(() => mine.some((c) => c.table === 'notifications'))).toBe(true)
    await new Promise((r) => setTimeout(r, 300))
    expect(other.filter((c) => c.table === 'notifications')).toHaveLength(0)
    offMine()
    offOther()
  })
})

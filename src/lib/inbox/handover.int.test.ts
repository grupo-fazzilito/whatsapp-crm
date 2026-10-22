// AI → human handover against a real Postgres: assignment, the "waiting for
// a person" flag, the timeline event and who gets notified.
// TEST_DATABASE_URL=postgresql://crm:crm@127.0.0.1:5434/crm npx vitest run src/lib/inbox/handover
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { pgTest } from '@/lib/test-utils/pg'

vi.mock('server-only', () => ({}))
const pg = await pgTest()

describe.skipIf(!pg)('AI handover', async () => {
  if (!pg) return
  const { handOverConversation } = await import('./server')
  const ws = await pg.workspace()
  // Two more people in the business: Bea (available) and Carlos (away).
  const bea = await pg.workspace()
  const carlos = await pg.workspace()
  let teamId = ''
  const newConversation = async () => {
    const contact = await ws.db.contacts.create({ data: { workspace_id: ws.workspaceId, name: 'Ana' }, select: { id: true } })
    return (await ws.db.conversations.create({ data: { workspace_id: ws.workspaceId, contact_id: contact.id }, select: { id: true } })).id
  }
  const notified = (conversationId: string) =>
    ws.db.notifications.findMany({ where: { conversation_id: conversationId }, select: { user_id: true, type: true, title: true } })

  beforeAll(async () => {
    await pg.prisma.workspace_members.createMany({
      data: [
        { workspace_id: ws.workspaceId, user_id: bea.userId, role: 'agent', available: true },
        { workspace_id: ws.workspaceId, user_id: carlos.userId, role: 'agent', available: false },
      ],
    })
    // The owner is away too: only Bea is available.
    await pg.prisma.workspace_members.updateMany({ where: { workspace_id: ws.workspaceId, user_id: ws.userId }, data: { available: false } })
    const team = await ws.db.teams.create({ data: { workspace_id: ws.workspaceId, name: 'Ventas' }, select: { id: true } })
    teamId = team.id
    await ws.db.team_members.create({ data: { workspace_id: ws.workspaceId, team_id: teamId, user_id: carlos.userId } })
  })
  afterAll(async () => {
    await pg.cleanup(ws, bea, carlos)
  })

  it('without an assignee: flags the conversation, logs it and alerts everyone available', async () => {
    const id = await newConversation()
    expect(await handOverConversation({ workspaceId: ws.workspaceId, conversationId: id, reason: 'El cliente pidió hablar con una persona' })).toBeNull()
    const conv = await ws.db.conversations.findFirstOrThrow({ where: { id } })
    expect(conv.needs_human_since).not.toBeNull()
    expect(conv.assigned_agent_id).toBeNull()
    const ev = await ws.db.conversation_events.findFirstOrThrow({ where: { conversation_id: id, type: 'ai_handover' } })
    expect(ev.note).toBe('El cliente pidió hablar con una persona')
    expect(await notified(id)).toEqual([{ user_id: bea.userId, type: 'handover', title: 'Atención requerida: la IA pasó una conversación' }])
  })

  it("to the agent's member: assigns and notifies only them", async () => {
    const id = await newConversation()
    const assignee = await handOverConversation({
      workspaceId: ws.workspaceId,
      conversationId: id,
      reason: 'Posible emergencia',
      target: { handover_mode: 'member', handover_user_id: carlos.userId },
    })
    expect(assignee).toBe(carlos.userId)
    expect((await ws.db.conversations.findFirstOrThrow({ where: { id } })).assigned_agent_id).toBe(carlos.userId)
    expect(await notified(id)).toEqual([{ user_id: carlos.userId, type: 'handover', title: 'La IA te pasó una conversación' }])
  })

  it("to the agent's team: nobody there is available, so the whole team is alerted", async () => {
    const id = await newConversation()
    const assignee = await handOverConversation({
      workspaceId: ws.workspaceId,
      conversationId: id,
      reason: 'x',
      target: { handover_mode: 'team', handover_team_id: teamId },
    })
    expect(assignee).toBeNull()
    expect((await ws.db.conversations.findFirstOrThrow({ where: { id } })).team_id).toBe(teamId)
    expect((await notified(id)).map((n) => n.user_id)).toEqual([carlos.userId])
  })

  it('an explicit person (welcome menu) wins over the agent setting; the current assignee keeps it otherwise', async () => {
    const id = await newConversation()
    await handOverConversation({ workspaceId: ws.workspaceId, conversationId: id, reason: 'menú', assigneeUserId: bea.userId, target: { handover_mode: 'member', handover_user_id: carlos.userId } })
    expect((await ws.db.conversations.findFirstOrThrow({ where: { id } })).assigned_agent_id).toBe(bea.userId)
    await handOverConversation({ workspaceId: ws.workspaceId, conversationId: id, reason: 'otra vez', target: { handover_mode: 'member', handover_user_id: carlos.userId } })
    expect((await ws.db.conversations.findFirstOrThrow({ where: { id } })).assigned_agent_id).toBe(bea.userId)
  })

  it('round-robin workspaces hand it to the next available person', async () => {
    await ws.db.workspaces.updateMany({ where: { id: ws.workspaceId }, data: { settings: { inbox: { auto_assign: 'round_robin' } } } })
    const id = await newConversation()
    expect(await handOverConversation({ workspaceId: ws.workspaceId, conversationId: id, reason: 'x' })).toBe(bea.userId)
    await ws.db.workspaces.updateMany({ where: { id: ws.workspaceId }, data: { settings: {} } })
  })

  it('a team member replying clears "waiting for a person"', async () => {
    const id = await newConversation()
    await handOverConversation({ workspaceId: ws.workspaceId, conversationId: id, reason: 'x' })
    const { sendMessage } = await import('@/lib/messaging/send')
    // No channel: the send fails, so nothing changes.
    await sendMessage({ workspaceId: ws.workspaceId, conversationId: id, content: { type: 'text', text: 'hola' }, sender: { type: 'agent', userId: bea.userId } })
    expect((await ws.db.conversations.findFirstOrThrow({ where: { id } })).needs_human_since).not.toBeNull()
    // With a web chat channel (no provider round-trip) the reply goes out and clears it.
    const ch = await ws.db.channels.create({ data: { workspace_id: ws.workspaceId, type: 'webchat', name: 'Web', external_id: `pk_handover_${ws.workspaceId}` }, select: { id: true } })
    await ws.db.conversations.updateMany({ where: { id }, data: { channel_id: ch.id } })
    const conv = await ws.db.conversations.findFirstOrThrow({ where: { id }, select: { contact_id: true } })
    await ws.db.contact_identities.create({ data: { workspace_id: ws.workspaceId, contact_id: conv.contact_id, channel_type: 'webchat', external_id: `v_${id}` } })
    const res = await sendMessage({ workspaceId: ws.workspaceId, conversationId: id, content: { type: 'text', text: 'hola' }, sender: { type: 'agent', userId: bea.userId } })
    expect(res.status).not.toBe('failed')
    expect((await ws.db.conversations.findFirstOrThrow({ where: { id } })).needs_human_since).toBeNull()
  })

  it('every new business starts with a sales pipeline', async () => {
    const p = await ws.db.pipelines.findFirstOrThrow({ where: { key: 'sales' } })
    const stages = await ws.db.pipeline_stages.findMany({ where: { pipeline_id: p.id }, orderBy: { position: 'asc' } })
    expect(p.name).toBe('Ventas')
    expect(stages.map((s) => s.key)).toEqual(['new', 'contacted', 'interested', 'proposal', 'negotiation', 'closing'])
  })
})

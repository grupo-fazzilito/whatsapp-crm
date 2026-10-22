import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiAgentRow } from './types'

// Real PostgreSQL (TEST_DATABASE_URL); the pure tests at the end run without it.
const h = vi.hoisted(() => {
  // The Prisma client is created on import; it only connects on the first query.
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgresql://unused:unused@127.0.0.1:1/unused'
  return {
    completeJson: vi.fn(),
    sendMessage: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({ messageId: 'm', externalId: null, status: 'sent' })),
    createBookingFromDraft: vi.fn(),
    canSpend: vi.fn(async () => true),
    spend: vi.fn(async () => 100),
    ctx: null as unknown,
  }
})

vi.mock('server-only', () => ({}))
vi.mock('@/lib/messaging/send', () => ({ sendMessage: h.sendMessage }))
vi.mock('@/lib/billing/credits', () => ({ canSpend: h.canSpend, spend: h.spend }))
vi.mock('@/lib/inbox/server', () => ({ handOverConversation: vi.fn(async () => null) }))
vi.mock('./llm', async (orig) => ({
  ...(await orig<typeof import('./llm')>()),
  completeJson: h.completeJson,
  llmConfigured: () => true,
}))
vi.mock('./context', () => ({ loadBusinessContext: async () => h.ctx, invalidateBusinessContext: () => {} }))
vi.mock('./bookings', () => ({ createBookingFromDraft: h.createBookingFromDraft, cancelNextBooking: vi.fn() }))
vi.mock('./prompt', async (orig) => ({ ...(await orig<typeof import('./prompt')>()), buildSystemPrompt: () => 'SYSTEM' }))

import { pgTest } from '@/lib/test-utils/pg'
import { HANDOVER_PAUSE_MS, runAgent, toCatalogQuery } from './engine'

const pg = await pgTest()

function agent(id: string, workspaceId: string, name: string, extra: Partial<AiAgentRow> = {}): AiAgentRow {
  return {
    id,
    workspace_id: workspaceId,
    name,
    description: null,
    persona: null,
    tone: 'friendly',
    instructions: null,
    language: 'es',
    skills: ['faq', 'handover', 'bookings'],
    greeting_message: null,
    after_hours_message: null,
    escalation_keywords: [],
    business_hours_only: false,
    model: null,
    enabled: true,
    transfer_agent_ids: [],
    ...extra,
  }
}

function out(o: Record<string, unknown>) {
  return JSON.stringify({
    reply: '',
    intent: 'other',
    language: 'es',
    confidence: 0.9,
    handover: false,
    transfer_to_agent_id: '',
    booking_action: 'none',
    ...o,
  })
}

const sentTexts = () => h.sendMessage.mock.calls.map((c) => ((c[0] as { content: { text?: string } }).content.text))

describe.skipIf(!pg)('runAgent', () => {
  let made: Awaited<ReturnType<NonNullable<typeof pg>['workspace']>>
  let WS = ''
  let contactId = ''
  let channelId = ''
  let conversationId = ''
  let router: AiAgentRow
  let sales: AiAgentRow
  let support: AiAgentRow

  beforeAll(async () => {
    made = await pg!.workspace({ name: 'Demo' })
    WS = made.workspaceId
    const db = made.db
    const r = await db.ai_agents.create({ data: { workspace_id: WS, name: 'Sofía', skills: ['router'] } })
    const s1 = await db.ai_agents.create({ data: { workspace_id: WS, name: 'Max', skills: ['faq', 'handover', 'bookings'], transfer_agent_ids: [r.id] } })
    const s2 = await db.ai_agents.create({ data: { workspace_id: WS, name: 'Leo', skills: ['faq', 'handover', 'bookings'] } })
    router = agent(r.id, WS, 'Sofía', { skills: ['router'] })
    sales = agent(s1.id, WS, 'Max', { transfer_agent_ids: [r.id] })
    support = agent(s2.id, WS, 'Leo')
    channelId = (await db.channels.create({ data: { workspace_id: WS, type: 'whatsapp', name: 'WA', external_id: `test-${WS}` } })).id
  })

  afterAll(async () => {
    if (made) await pg!.cleanup(made)
  })

  beforeEach(async () => {
    contactId = (await made.db.contacts.create({ data: { workspace_id: WS, name: 'Ana', phone: '+5215550000000' } })).id
    const conv = await made.db.conversations.create({ data: { workspace_id: WS, contact_id: contactId, channel_id: channelId, ai_state: {}, unread_count: 0, status: 'open' } })
    conversationId = conv.id
    await made.db.messages.create({
      data: { workspace_id: WS, conversation_id: conversationId, sender_type: 'customer', content_type: 'text', content_text: 'Quiero comprar', created_at: '2026-01-01T00:00:00Z' },
    })
    h.ctx = {
      workspace: { id: WS, name: 'Demo', industry: 'general', settings: {}, locale: 'es' },
      timeZone: 'America/Mexico_City',
      hours: [],
      exceptions: [],
      staff: [],
      services: [],
      faqs: [],
      agents: [router, sales, support],
      bookings: [],
    }
    h.completeJson.mockReset()
    h.sendMessage.mockClear()
    h.createBookingFromDraft.mockReset()
    h.canSpend.mockClear()
    h.canSpend.mockResolvedValue(true)
    h.spend.mockClear()
  })

  const input = (a: AiAgentRow) => ({
    workspaceId: WS,
    channel: { id: channelId, type: 'whatsapp', workspace_id: WS, settings: {} } as never,
    agent: a,
    contactId,
    conversationId,
    messageText: 'Quiero comprar',
    isFirstInboundMessage: false,
  })
  const conversation = () => made.db.conversations.findUniqueOrThrow({ where: { id: conversationId } })

  it('charges one credit per model turn, even when it transfers to another agent', async () => {
    h.completeJson
      .mockResolvedValueOnce(out({ intent: 'transfer', transfer_to_agent_id: sales.id, reply: 'Te paso con Max' }))
      .mockResolvedValueOnce(out({ reply: '¡Hola! Soy Max' }))
    await runAgent(input(router))
    expect(h.canSpend).toHaveBeenCalledTimes(1)
    expect(h.canSpend).toHaveBeenCalledWith(WS, 'reply')
    expect(h.spend).toHaveBeenCalledTimes(1)
    expect(h.spend).toHaveBeenCalledWith(WS, 'reply', { conversationId })
  })

  it('out of credits: no model call, nothing sent, the message stays for the team', async () => {
    h.canSpend.mockResolvedValueOnce(false)
    expect(await runAgent(input(sales))).toBe(false)
    expect(h.completeJson).not.toHaveBeenCalled()
    expect(sentTexts()).toEqual([])
    expect(h.spend).not.toHaveBeenCalled()
  })

  it('does not charge when the model fails', async () => {
    h.completeJson.mockRejectedValueOnce(new Error('boom'))
    await runAgent(input(sales))
    expect(h.spend).not.toHaveBeenCalled()
  })

  it('transfer: pins the target, logs a system divider, and the target answers once (depth guard)', async () => {
    // Router → Max; Max tries to bounce back to the router → ignored (depth 1).
    h.completeJson
      .mockResolvedValueOnce(out({ intent: 'transfer', transfer_to_agent_id: sales.id, reply: 'Te paso con Max' }))
      .mockResolvedValueOnce(out({ intent: 'transfer', transfer_to_agent_id: router.id, reply: '¡Hola! Soy Max, ¿qué buscas?' }))

    expect(await runAgent(input(router))).toBe(true)

    expect(h.completeJson).toHaveBeenCalledTimes(2)
    expect((await conversation()).ai_agent_id).toBe(sales.id)
    const divider = await made.db.messages.findFirst({ where: { conversation_id: conversationId, content_type: 'system' } })
    expect(divider).toMatchObject({ content_text: 'Sofía → Max', metadata: { event: 'agent_transfer', from: router.id, to: sales.id } })
    // Only the target replied (with its own text), from its own identity.
    expect(sentTexts()).toEqual(['¡Hola! Soy Max, ¿qué buscas?'])
    expect(h.sendMessage.mock.calls[0][0]).toMatchObject({ sender: { type: 'bot', aiAgentId: sales.id } })
  })

  it('transfer is ignored when the target is not allowed for a non-router agent', async () => {
    h.completeJson.mockResolvedValueOnce(out({ transfer_to_agent_id: support.id, reply: 'Respuesta normal' }))
    await runAgent(input(sales)) // Max may only transfer to the router
    expect(h.completeJson).toHaveBeenCalledTimes(1)
    expect((await conversation()).ai_agent_id).toBeNull()
    expect(sentTexts()).toEqual(['Respuesta normal'])
  })

  it('handover: replies, pauses the AI and leaves a note', async () => {
    h.completeJson.mockResolvedValueOnce(out({ handover: true, intent: 'handover', reply: 'Te comunico con alguien' }))
    const before = Date.now()
    await runAgent(input(sales))
    const conv = await conversation()
    const paused = new Date(conv.ai_paused_until as string).getTime()
    expect(paused).toBeGreaterThanOrEqual(before + HANDOVER_PAUSE_MS - 1000)
    expect(conv.unread_count).toBe(1)
    expect(sentTexts()).toEqual(['Te comunico con alguien'])
    expect(await made.db.contact_notes.count({ where: { contact_id: contactId } })).toBe(1)
  })

  it('booking confirm: calls createBookingFromDraft with the merged draft and clears it', async () => {
    await made.db.conversations.update({ where: { id: conversationId }, data: { ai_state: { booking: { date: '2099-01-10' } } } })
    h.createBookingFromDraft.mockResolvedValueOnce({ ok: true, bookingId: 'b1', staffName: null, serviceName: null })
    h.completeJson.mockResolvedValueOnce(
      out({ intent: 'booking', booking_action: 'confirm', reply: 'Confirmo', booking: { time: '10:30', customer_name: 'Ana' } }),
    )
    await runAgent(input(sales))
    expect(h.createBookingFromDraft).toHaveBeenCalledTimes(1)
    expect(h.createBookingFromDraft.mock.calls[0][0]).toMatchObject({
      workspaceId: WS,
      contactId,
      conversationId,
      aiAgentId: sales.id,
      source: 'ai',
      draft: { date: '2099-01-10', time: '10:30', customer_name: 'Ana' },
    })
    expect(((await conversation()).ai_state as { booking?: unknown }).booking).toBeUndefined()
    expect(sentTexts()[0]).toContain('10 de enero')
  })
})

describe('catalog_search → searchProducts query', () => {
  it('passes the budget currency so price bounds only compare that currency', () => {
    expect(toCatalogQuery({ text: 'casa', max_price: 300000, currency: 'dólares' })).toMatchObject({ maxPrice: 300000, priceCurrency: 'USD' })
    expect(toCatalogQuery({ text: 'depa', max_price: 3000 })).toMatchObject({ maxPrice: 3000, priceCurrency: null })
  })
})

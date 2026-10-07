import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeDb } from '@/lib/test-utils/fake-supabase'
import type { AiAgentRow } from './types'

const h = vi.hoisted(() => ({
  db: null as unknown as import('@/lib/test-utils/fake-supabase').FakeDb,
  completeJson: vi.fn(),
  sendMessage: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({ messageId: 'm', externalId: null, status: 'sent' })),
  createBookingFromDraft: vi.fn(),
  ctx: null as unknown,
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => h.db }))
vi.mock('@/lib/messaging/send', () => ({ sendMessage: h.sendMessage }))
vi.mock('./llm', async (orig) => ({
  ...(await orig<typeof import('./llm')>()),
  completeJson: h.completeJson,
  llmConfigured: () => true,
}))
vi.mock('./context', () => ({ loadBusinessContext: async () => h.ctx, invalidateBusinessContext: () => {} }))
vi.mock('./bookings', () => ({ createBookingFromDraft: h.createBookingFromDraft, cancelNextBooking: vi.fn() }))
vi.mock('./prompt', async (orig) => ({ ...(await orig<typeof import('./prompt')>()), buildSystemPrompt: () => 'SYSTEM' }))

import { HANDOVER_PAUSE_MS, runAgent } from './engine'

const WS = 'ws1'

function agent(id: string, name: string, extra: Partial<AiAgentRow> = {}): AiAgentRow {
  return {
    id,
    workspace_id: WS,
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

const router = agent('r1', 'Sofía', { skills: ['router'] })
const sales = agent('s1', 'Max', { transfer_agent_ids: ['r1'] })
const support = agent('s2', 'Leo')

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

function setup() {
  h.db = new FakeDb({
    conversations: [{ id: 'c1', workspace_id: WS, ai_state: {}, ai_agent_id: null, unread_count: 0, status: 'open' }],
    messages: [{ id: 'in1', workspace_id: WS, conversation_id: 'c1', sender_type: 'customer', content_type: 'text', content_text: 'Quiero comprar', created_at: '2026-01-01T00:00:00Z' }],
    bookings: [],
    ai_chat_logs: [],
    contact_notes: [],
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
}

const input = (a: AiAgentRow) => ({
  workspaceId: WS,
  channel: { id: 'ch1', type: 'whatsapp', workspace_id: WS, settings: {} } as never,
  agent: a,
  contactId: 'ct1',
  conversationId: 'c1',
  messageText: 'Quiero comprar',
  isFirstInboundMessage: false,
})

const sentTexts = () => h.sendMessage.mock.calls.map((c) => ((c[0] as { content: { text?: string } }).content.text))

describe('runAgent', () => {
  beforeEach(() => {
    setup()
    h.completeJson.mockReset()
    h.sendMessage.mockClear()
    h.createBookingFromDraft.mockReset()
  })

  it('transfer: pins the target, logs a system divider, and the target answers once (depth guard)', async () => {
    // Router → Max; Max tries to bounce back to the router → ignored (depth 1).
    h.completeJson
      .mockResolvedValueOnce(out({ intent: 'transfer', transfer_to_agent_id: 's1', reply: 'Te paso con Max' }))
      .mockResolvedValueOnce(out({ intent: 'transfer', transfer_to_agent_id: 'r1', reply: '¡Hola! Soy Max, ¿qué buscas?' }))

    expect(await runAgent(input(router))).toBe(true)

    expect(h.completeJson).toHaveBeenCalledTimes(2)
    expect(h.db.rows('conversations')[0].ai_agent_id).toBe('s1')
    const divider = h.db.rows('messages').find((m) => m.content_type === 'system')
    expect(divider).toMatchObject({ content_text: 'Sofía → Max', metadata: { event: 'agent_transfer', from: 'r1', to: 's1' } })
    // Only the target replied (with its own text), from its own identity.
    expect(sentTexts()).toEqual(['¡Hola! Soy Max, ¿qué buscas?'])
    expect(h.sendMessage.mock.calls[0][0]).toMatchObject({ sender: { type: 'bot', aiAgentId: 's1' } })
  })

  it('transfer is ignored when the target is not allowed for a non-router agent', async () => {
    h.completeJson.mockResolvedValueOnce(out({ transfer_to_agent_id: 's2', reply: 'Respuesta normal' }))
    await runAgent(input(sales)) // Max may only transfer to the router
    expect(h.completeJson).toHaveBeenCalledTimes(1)
    expect(h.db.rows('conversations')[0].ai_agent_id).toBeNull()
    expect(sentTexts()).toEqual(['Respuesta normal'])
  })

  it('handover: replies, pauses the AI and leaves a note', async () => {
    h.completeJson.mockResolvedValueOnce(out({ handover: true, intent: 'handover', reply: 'Te comunico con alguien' }))
    const before = Date.now()
    await runAgent(input(sales))
    const conv = h.db.rows('conversations')[0]
    const paused = new Date(conv.ai_paused_until as string).getTime()
    expect(paused).toBeGreaterThanOrEqual(before + HANDOVER_PAUSE_MS - 1000)
    expect(conv.unread_count).toBe(1)
    expect(sentTexts()).toEqual(['Te comunico con alguien'])
    expect(h.db.rows('contact_notes')).toHaveLength(1)
  })

  it('booking confirm: calls createBookingFromDraft with the merged draft and clears it', async () => {
    h.db.rows('conversations')[0].ai_state = { booking: { date: '2099-01-10' } }
    h.createBookingFromDraft.mockResolvedValueOnce({ ok: true, bookingId: 'b1', staffName: null, serviceName: null })
    h.completeJson.mockResolvedValueOnce(
      out({ intent: 'booking', booking_action: 'confirm', reply: 'Confirmo', booking: { time: '10:30', customer_name: 'Ana' } }),
    )
    await runAgent(input(sales))
    expect(h.createBookingFromDraft).toHaveBeenCalledTimes(1)
    expect(h.createBookingFromDraft.mock.calls[0][0]).toMatchObject({
      workspaceId: WS,
      contactId: 'ct1',
      conversationId: 'c1',
      aiAgentId: 's1',
      source: 'ai',
      draft: { date: '2099-01-10', time: '10:30', customer_name: 'Ana' },
    })
    expect((h.db.rows('conversations')[0].ai_state as { booking?: unknown }).booking).toBeUndefined()
    expect(sentTexts()[0]).toContain('10 de enero')
  })
})

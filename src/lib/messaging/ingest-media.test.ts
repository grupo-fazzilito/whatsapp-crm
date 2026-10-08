import { beforeEach, describe, expect, it, vi } from 'vitest'

// The AI-assist pre-routing hook: an inbound voice note reaches flows and
// the AI agent as its transcript; failures leave the pipeline untouched.

vi.mock('server-only', () => ({}))

// Minimal chainable Supabase fake: every query resolves per table.
const tableData: Record<string, unknown> = {}
function builder(table: string) {
  const result = () => ({ data: tableData[table] ?? null, error: null, count: 0 })
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'neq', 'in', 'not', 'order', 'limit', 'update', 'delete', 'upsert', 'gte', 'lte']) b[m] = () => b
  b.insert = () => b
  b.single = async () => result()
  // messages: lookups (dedupe, reply-to) find nothing; insert().single() returns the row.
  b.maybeSingle = async () => (table === 'messages' ? { data: null, error: null } : result())
  b.then = (resolve: (v: unknown) => unknown) => resolve(result())
  return b
}
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: (t: string) => builder(t) }) }))

const routeInbound = vi.fn<(input: { messageText: string }) => Promise<boolean>>(async () => true)
const dispatchInboundToFlows = vi.fn<(input: { message: { kind: string; text?: string } }) => Promise<{ consumed: boolean }>>(async () => ({ consumed: false }))
const handlePaymentProof = vi.fn(async () => false)
const inboundMediaText = vi.fn()

vi.mock('@/lib/ai/routing', () => ({ routeInbound: (i: { messageText: string }) => routeInbound(i) }))
vi.mock('@/lib/flows/engine', () => ({ dispatchInboundToFlows: (i: { message: { kind: string; text?: string } }) => dispatchInboundToFlows(i) }))
vi.mock('@/lib/automations/engine', () => ({ runAutomationsForTrigger: vi.fn(async () => {}) }))
vi.mock('@/lib/automations/followups', () => ({ cancelFollowupsForInbound: vi.fn(async () => {}) }))
vi.mock('@/lib/orders/chat', () => ({
  handleCheckoutText: vi.fn(async () => false),
  handleCommerceAction: vi.fn(async () => false),
  handlePaymentProof: () => handlePaymentProof(),
  isCommerceAction: () => false,
}))
vi.mock('@/lib/inbox/server', () => ({ autoAssignConversation: vi.fn(async () => {}), recordEvent: vi.fn(async () => {}) }))
vi.mock('@/lib/real-estate/leads/visits', () => ({ handleVisitAction: vi.fn(async () => false), isVisitAction: () => false }))
vi.mock('@/lib/ai/assist/service', () => ({ inboundMediaText: (i: unknown) => inboundMediaText(i) }))
vi.mock('@/lib/channels/parsers/whatsapp', () => ({ waMediaProxyUrl: (c: string, m: string) => `/api/media/${c}/${m}` }))

import { ingestMessage } from './ingest'
import type { LoadedChannel } from '@/lib/channels'

const channel = { id: 'ch1', workspace_id: 'ws1', type: 'whatsapp', ai_agent_id: 'agent1', settings: {}, secrets: {} } as unknown as LoadedChannel

function voiceNote(contentType: 'audio' | 'image' = 'audio') {
  return {
    kind: 'message' as const,
    channelExternalId: 'pn',
    from: { externalId: '51999', phone: '51999' },
    externalMessageId: `wamid.${Math.random()}`,
    timestamp: Date.now(),
    contentType,
    text: contentType === 'image' ? 'mira' : null,
    mediaUrl: 'wa-media:MEDIA1',
  }
}

beforeEach(() => {
  tableData.contact_identities = { contact_id: 'c1' }
  tableData.conversations = { id: 'conv1', status: 'open', unread_count: 0, ai_agent_id: null, ai_state: {} }
  tableData.messages = { id: 'm1' }
  tableData.workspaces = { id: 'ws1', settings: {} }
})

describe('ingest AI-assist media hook', () => {
  it('passes the transcript of a voice note to flows and AI routing', async () => {
    inboundMediaText.mockResolvedValue('Hola, quiero separar una visita el sábado')
    const out = await ingestMessage(channel, voiceNote())
    expect(out?.messageId).toBe('m1')
    expect(inboundMediaText).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'ws1', messageId: 'm1', contentType: 'audio', mediaUrl: '/api/media/ch1/MEDIA1', aiWillAnswer: true, aiAgentId: 'agent1' }),
    )
    expect(dispatchInboundToFlows.mock.calls[0][0].message).toMatchObject({ kind: 'text', text: 'Hola, quiero separar una visita el sábado' })
    expect(routeInbound.mock.calls[0][0].messageText).toBe('Hola, quiero separar una visita el sábado')
  })

  it('keeps going with the original text when the hook gives nothing (no provider / error)', async () => {
    inboundMediaText.mockResolvedValue(null)
    await ingestMessage(channel, voiceNote())
    expect(routeInbound).toHaveBeenCalled()
    expect(routeInbound.mock.calls[0][0].messageText).toBe('')
  })

  it('payment-proof capture runs before the image hook', async () => {
    handlePaymentProof.mockResolvedValueOnce(true as never)
    await ingestMessage(channel, voiceNote('image'))
    expect(inboundMediaText).not.toHaveBeenCalled()
    expect(routeInbound).not.toHaveBeenCalled()
  })
})

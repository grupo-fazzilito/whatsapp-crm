import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { pgTest } from '@/lib/test-utils/pg'

// The AI-assist pre-routing hook: an inbound voice note reaches flows and
// the AI agent as its transcript; failures leave the pipeline untouched.
// Runs against a real PostgreSQL (TEST_DATABASE_URL); skipped without it.

vi.mock('server-only', () => ({}))

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

import type { LoadedChannel } from '@/lib/channels'

const pg = await pgTest()

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

describe.skipIf(!pg)('ingest AI-assist media hook', () => {
  let made: Awaited<ReturnType<NonNullable<typeof pg>['workspace']>>
  let channel: LoadedChannel
  let ingestMessage: typeof import('./ingest').ingestMessage

  beforeAll(async () => {
    ;({ ingestMessage } = await import('./ingest'))
    made = await pg!.workspace()
    const row = await made.db.channels.create({
      data: { workspace_id: made.workspaceId, type: 'whatsapp', name: 'WA', external_id: `pn-${made.workspaceId}`, created_by: made.userId },
    })
    // The channel's agent only reaches the mocked routing / AI-assist hooks.
    channel = { ...row, ai_agent_id: 'agent1', secrets: {} } as unknown as LoadedChannel
  })
  afterAll(async () => {
    if (made) await pg!.cleanup(made)
  })

  it('passes the transcript of a voice note to flows and AI routing', async () => {
    inboundMediaText.mockResolvedValue('Hola, quiero separar una visita el sábado')
    const out = await ingestMessage(channel, voiceNote())
    expect(out?.messageId).toBeTruthy()
    const stored = await made.db.messages.findFirst({ where: { id: out!.messageId! } })
    expect(stored).toMatchObject({ sender_type: 'customer', content_type: 'audio', media_url: '/api/media/' + channel.id + '/MEDIA1' })
    expect(inboundMediaText).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: made.workspaceId, messageId: out!.messageId, contentType: 'audio', mediaUrl: `/api/media/${channel.id}/MEDIA1`, aiWillAnswer: true, aiAgentId: 'agent1' }),
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

  it('a retried webhook is stored once', async () => {
    inboundMediaText.mockResolvedValue(null)
    const ev = voiceNote()
    const first = await ingestMessage(channel, ev)
    const again = await ingestMessage(channel, ev)
    expect(again).toMatchObject({ duplicate: true, messageId: first!.messageId })
  })
})

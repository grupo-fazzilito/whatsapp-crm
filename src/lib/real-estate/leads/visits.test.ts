import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeDb } from '@/lib/test-utils/fake-supabase'

const BOOKING = '11111111-1111-4111-8111-111111111111'
const PRODUCT = '22222222-2222-4222-8222-222222222222'
const OTHER = '33333333-3333-4333-8333-333333333333'

const h = vi.hoisted(() => ({
  db: null as unknown as import('@/lib/test-utils/fake-supabase').FakeDb,
  sendMessage: vi.fn(async () => ({ messageId: 'm', externalId: null, status: 'sent' })),
  notify: vi.fn(async () => {}),
  moveContactDeal: vi.fn(async () => ({ dealId: 'd1', created: false, moved: true, assignedTo: null })),
  rescoreLead: vi.fn(async () => ({ id: 'l1', temperature: 'hot', operation: 'rent', zones: ['Miraflores'], budget_max: 3000 })),
  advisorFor: vi.fn(async () => 'advisor-1' as string | null),
  sendProperties: vi.fn(async () => 1),
  matchingProperties: vi.fn(async () => [{ product: { id: 'p9', name: 'Otro depa' }, rank: 10 }]),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => h.db }))
vi.mock('@/lib/messaging/send', () => ({ sendMessage: h.sendMessage }))
vi.mock('@/lib/inbox/server', () => ({ notify: h.notify }))
vi.mock('./pipeline', () => ({ moveContactDeal: h.moveContactDeal }))
vi.mock('./service', () => ({
  rescoreLead: h.rescoreLead,
  advisorFor: h.advisorFor,
  getLeadProfile: vi.fn(async () => null),
  workspaceAdmins: vi.fn(async () => ['admin-1']),
}))
vi.mock('./properties', () => ({
  loadWs: async () => ({ id: 'ws', name: 'Inmo', slug: 'inmo', locale: 'es', country: 'PE', currency: 'PEN' }),
  loadProperty: async (_ws: string, id: string) => ({ id, name: 'Depa Miraflores', price: 2800, images: [], attributes: { operation: 'rent', zone: 'Miraflores' }, is_active: true }),
  matchingProperties: h.matchingProperties,
  sendProperties: h.sendProperties,
  sendPropertyLocation: vi.fn(async () => true),
}))

import { feedbackDue, handleVisitAction, isVisitAction, parseVisitAction, stageForFeedback } from './visits'

const ctx = { workspaceId: 'ws', conversationId: 'c1', contactId: 'k1', aiAgentId: 'a1' }

beforeEach(() => {
  vi.clearAllMocks()
  h.db = new FakeDb()
  h.db.tables.bookings = [{ id: BOOKING, workspace_id: 'ws', contact_id: 'k1', product_id: PRODUCT, staff_id: null, conversation_id: 'c1', viewing_feedback: null }]
  h.db.tables.conversations = [{ id: 'c1', workspace_id: 'ws', ai_state: { menu_pending: false } }]
  h.db.tables.contacts = [{ id: 'k1', name: 'Ana' }]
})

describe('visit button ids', () => {
  it('parses feedback and booking buttons', () => {
    expect(isVisitAction(`visit:interested:${BOOKING}`)).toBe(true)
    expect(isVisitAction('cart:add:x')).toBe(false)
    expect(parseVisitAction(`visit:not_convinced:${BOOKING}`)).toEqual({ kind: 'feedback', feedback: 'not_convinced', bookingId: BOOKING })
    expect(parseVisitAction(`visit:book:${PRODUCT}`)).toEqual({ kind: 'book', productId: PRODUCT })
    expect(parseVisitAction('visit:maybe:' + BOOKING)).toBeNull()
    expect(parseVisitAction('visit:interested:nope')).toBeNull()
  })

  it('maps answers to stages', () => {
    expect(stageForFeedback('interested')).toBe('negotiation')
    expect(stageForFeedback('others')).toBe('viewed')
    expect(stageForFeedback('not_convinced')).toBe('viewed')
  })

  it('asks for feedback between 2 h and 48 h after the visit (workspace time zone)', () => {
    // 10:00 Lima = 15:00 UTC
    expect(feedbackDue('2026-10-08', '10:00', 'America/Lima', new Date('2026-10-08T16:59:00Z'))).toBe(false)
    expect(feedbackDue('2026-10-08', '10:00', 'America/Lima', new Date('2026-10-08T17:00:00Z'))).toBe(true)
    expect(feedbackDue('2026-10-08', '10:00', 'America/Lima', new Date('2026-10-10T16:00:00Z'))).toBe(false)
  })
})

describe('handleVisitAction', () => {
  it('"Me interesa" → negotiation, advisor notified, customer told', async () => {
    expect(await handleVisitAction(ctx, `visit:interested:${BOOKING}`)).toBe(true)
    expect(h.db.tables.bookings[0].viewing_feedback).toBe('interested')
    expect(h.moveContactDeal).toHaveBeenCalledWith(expect.objectContaining({ key: 'negotiation', contactId: 'k1' }))
    expect(h.rescoreLead).toHaveBeenCalledWith('ws', 'k1')
    const notes = (h.notify.mock.calls[0] as unknown as [{ userId: string; title: string }[]])[0]
    expect(notes).toHaveLength(1)
    expect(notes[0]).toMatchObject({ userId: 'advisor-1', title: 'Ana está interesado tras la visita' })
    expect(h.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ content: expect.objectContaining({ type: 'text' }) }))
    expect(h.sendProperties).not.toHaveBeenCalled()
  })

  it('"Ver otras opciones" → viewed + matching carousel without the visited listing', async () => {
    expect(await handleVisitAction(ctx, `visit:others:${BOOKING}`)).toBe(true)
    expect(h.moveContactDeal).toHaveBeenCalledWith(expect.objectContaining({ key: 'viewed' }))
    expect(h.matchingProperties).toHaveBeenCalledWith('ws', expect.anything(), expect.objectContaining({ excludeIds: [PRODUCT] }))
    expect(h.sendProperties).toHaveBeenCalledTimes(1)
  })

  it('falls back to admins when the lead has no advisor', async () => {
    h.advisorFor.mockResolvedValueOnce(null)
    await handleVisitAction(ctx, `visit:not_convinced:${BOOKING}`)
    const notes = (h.notify.mock.calls[0] as unknown as [{ userId: string }[]])[0]
    expect(notes.map((n) => n.userId)).toEqual(['admin-1'])
  })

  it('ignores bookings of another contact', async () => {
    expect(await handleVisitAction({ ...ctx, contactId: 'other' }, `visit:interested:${BOOKING}`)).toBe(false)
    expect(h.moveContactDeal).not.toHaveBeenCalled()
  })

  it('"Agendar visita" starts a viewing draft for the listing', async () => {
    expect(await handleVisitAction(ctx, `visit:book:${OTHER}`)).toBe(true)
    expect(h.db.tables.conversations[0].ai_state).toEqual({ menu_pending: false, booking: { product_id: OTHER } })
    expect(h.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ event: 'viewing_request', product_id: OTHER }) }))
  })
})

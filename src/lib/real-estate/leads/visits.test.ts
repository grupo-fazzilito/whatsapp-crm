import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { pgTest } from '@/lib/test-utils/pg'

// Button parsing and timing are pure; handleVisitAction runs against a real
// PostgreSQL (TEST_DATABASE_URL) and is skipped without it.

const OTHER = '33333333-3333-4333-8333-333333333333'

const h = vi.hoisted(() => ({
  sendMessage: vi.fn(async () => ({ messageId: 'm', externalId: null, status: 'sent' })),
  notify: vi.fn(async () => {}),
  moveContactDeal: vi.fn(async () => ({ dealId: 'd1', created: false, moved: true, assignedTo: null })),
  rescoreLead: vi.fn(async () => ({ id: 'l1', temperature: 'hot', operation: 'rent', zones: ['Miraflores'], budget_max: 3000 })),
  advisorFor: vi.fn(async () => 'advisor-1' as string | null),
  sendProperties: vi.fn(async () => 1),
  matchingProperties: vi.fn(async () => [{ product: { id: 'p9', name: 'Otro depa' }, rank: 10 }]),
}))

vi.mock('server-only', () => ({}))
// Without TEST_DATABASE_URL the module still loads for the pure tests.
vi.mock('@/lib/db/prisma', async (importOriginal) => {
  if (!process.env.TEST_DATABASE_URL) return { prisma: {} }
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
  return importOriginal()
})
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

const pg = await pgTest()

describe('visit button ids', () => {
  const BOOKING = '11111111-1111-4111-8111-111111111111'
  const PRODUCT = '22222222-2222-4222-8222-222222222222'
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

describe.skipIf(!pg)('handleVisitAction (PostgreSQL)', () => {
  let made: Awaited<ReturnType<NonNullable<typeof pg>['workspace']>>
  let ctx: { workspaceId: string; conversationId: string; contactId: string; aiAgentId: string | null }
  let bookingId = ''
  let productId = ''

  beforeAll(async () => {
    made = await pg!.workspace({ businessType: 'real_estate' })
  })
  afterAll(async () => {
    if (made) await pg!.cleanup(made)
  })

  beforeEach(async () => {
    const db = made.db
    const ws = made.workspaceId
    await db.bookings.deleteMany({})
    await db.conversations.deleteMany({})
    await db.contacts.deleteMany({})
    await db.products.deleteMany({})
    const contact = await db.contacts.create({ data: { workspace_id: ws, name: 'Ana' } })
    const conv = await db.conversations.create({ data: { workspace_id: ws, contact_id: contact.id, ai_state: { menu_pending: false } } })
    const product = await db.products.create({ data: { workspace_id: ws, name: 'Depa Miraflores', price: 2800, attributes: { operation: 'rent' } } })
    const booking = await db.bookings.create({
      data: { workspace_id: ws, contact_id: contact.id, product_id: product.id, conversation_id: conv.id, booking_date: '2026-10-08', booking_time: '10:00' },
    })
    bookingId = booking.id
    productId = product.id
    ctx = { workspaceId: ws, conversationId: conv.id, contactId: contact.id, aiAgentId: null }
  })

  it('"Me interesa" → negotiation, advisor notified, customer told', async () => {
    expect(await handleVisitAction(ctx, `visit:interested:${bookingId}`)).toBe(true)
    expect((await made.db.bookings.findFirst({ where: { id: bookingId } }))?.viewing_feedback).toBe('interested')
    expect(h.moveContactDeal).toHaveBeenCalledWith(expect.objectContaining({ key: 'negotiation', contactId: ctx.contactId }))
    expect(h.rescoreLead).toHaveBeenCalledWith(ctx.workspaceId, ctx.contactId)
    const notes = (h.notify.mock.calls[0] as unknown as [{ userId: string; title: string }[]])[0]
    expect(notes).toHaveLength(1)
    expect(notes[0]).toMatchObject({ userId: 'advisor-1', title: 'Ana está interesado tras la visita' })
    expect(h.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ content: expect.objectContaining({ type: 'text' }) }))
    expect(h.sendProperties).not.toHaveBeenCalled()
  })

  it('"Ver otras opciones" → viewed + matching carousel without the visited listing', async () => {
    expect(await handleVisitAction(ctx, `visit:others:${bookingId}`)).toBe(true)
    expect(h.moveContactDeal).toHaveBeenCalledWith(expect.objectContaining({ key: 'viewed' }))
    expect(h.matchingProperties).toHaveBeenCalledWith(ctx.workspaceId, expect.anything(), expect.objectContaining({ excludeIds: [productId] }))
    expect(h.sendProperties).toHaveBeenCalledTimes(1)
  })

  it('falls back to admins when the lead has no advisor', async () => {
    h.advisorFor.mockResolvedValueOnce(null)
    await handleVisitAction(ctx, `visit:not_convinced:${bookingId}`)
    const notes = (h.notify.mock.calls[0] as unknown as [{ userId: string }[]])[0]
    expect(notes.map((n) => n.userId)).toEqual(['admin-1'])
  })

  it('ignores bookings of another contact', async () => {
    const other = await made.db.contacts.create({ data: { workspace_id: made.workspaceId, name: 'Otro' } })
    expect(await handleVisitAction({ ...ctx, contactId: other.id }, `visit:interested:${bookingId}`)).toBe(false)
    expect(h.moveContactDeal).not.toHaveBeenCalled()
  })

  it('ignores bookings of another workspace', async () => {
    const stranger = await pg!.workspace()
    try {
      expect(await handleVisitAction({ ...ctx, workspaceId: stranger.workspaceId }, `visit:interested:${bookingId}`)).toBe(false)
      expect((await made.db.bookings.findFirst({ where: { id: bookingId } }))?.viewing_feedback).toBeNull()
    } finally {
      await pg!.cleanup(stranger)
    }
  })

  it('"Agendar visita" starts a viewing draft for the listing', async () => {
    expect(await handleVisitAction(ctx, `visit:book:${OTHER}`)).toBe(true)
    const conv = await made.db.conversations.findFirst({ where: { id: ctx.conversationId } })
    expect(conv?.ai_state).toEqual({ menu_pending: false, booking: { product_id: OTHER } })
    expect(h.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ event: 'viewing_request', product_id: OTHER }) }))
  })
})

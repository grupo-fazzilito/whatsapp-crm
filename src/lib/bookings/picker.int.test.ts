// Booking picker end to end against a real Postgres (sending is mocked).
// TEST_DATABASE_URL=postgresql://crm:crm@127.0.0.1:5434/crm npx vitest run src/lib/bookings/picker
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { pgTest } from '@/lib/test-utils/pg'

vi.mock('server-only', () => ({}))
const sent: { content: { type: string; text?: string; sections?: { options: { id: string; title: string }[] }[] }; sender: { type: string } }[] = []
vi.mock('@/lib/messaging/send', () => ({
  sendMessage: vi.fn(async (input: (typeof sent)[number]) => {
    sent.push(input)
    return { status: 'sent', externalId: `wamid.${sent.length}` }
  }),
}))

const pg = await pgTest()

describe.skipIf(!pg)('booking picker', async () => {
  if (!pg) return
  const { startBookingPicker, handleBookingPickerInbound } = await import('./picker')
  const { dispatchInboundToFlows } = await import('@/lib/flows/engine')
  const { invalidateBusinessContext } = await import('@/lib/ai/context')
  const p = pg.prisma
  const ws = await pg.workspace({ businessType: 'barbershop', name: 'Barbería Picker' })
  const W = ws.workspaceId
  const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
  await p.business_hours.deleteMany({ where: { workspace_id: W } })
  await p.business_hours.createMany({ data: DAYS.map((day_name) => ({ workspace_id: W, day_name, opening_time: '09:00', closing_time: '18:00', is_closed: false })) })
  await p.services.deleteMany({ where: { workspace_id: W } })
  await p.staff.deleteMany({ where: { workspace_id: W } })
  const service = await p.services.create({ data: { workspace_id: W, name: 'Corte clásico', duration_minutes: 30, is_active: true }, select: { id: true } })
  const barbers = await Promise.all(
    ['Luis', 'Mario'].map((name) =>
      p.staff.create({ data: { workspace_id: W, name, available_days: DAYS, available_start_time: '09:00', available_end_time: '18:00' }, select: { id: true } }),
    ),
  )
  const contact = await p.contacts.create({ data: { workspace_id: W, name: 'Ana Torres', phone: '51987000111' }, select: { id: true } })
  const conv = await p.conversations.create({ data: { workspace_id: W, contact_id: contact.id, last_customer_message_at: new Date() }, select: { id: true } })
  invalidateBusinessContext(W)

  const reply = (replyId: string | null, text = '') =>
    p.conversations
      .findFirstOrThrow({ where: { id: conv.id }, select: { booking_picker: true } })
      .then((c) => handleBookingPickerInbound({ workspaceId: W, conversationId: conv.id, contactId: contact.id, state: c.booking_picker, replyId, text }))
  const lastList = () => {
    const m = [...sent].reverse().find((s) => s.content.type === 'list')
    return m?.content.sections?.[0].options ?? []
  }

  beforeEach(() => {
    sent.length = 0
  })
  afterAll(async () => {
    await pg.cleanup(ws)
  })

  it('books from the inbox by tapping barber → day → time, without the AI', async () => {
    const r = await startBookingPicker({ workspaceId: W, conversationId: conv.id, origin: 'inbox', userId: ws.userId })
    expect(r).toEqual({ status: 'waiting' })
    // One service → straight to the barber; the first message comes from the team member.
    expect(sent[0].sender).toMatchObject({ type: 'agent' })
    expect(lastList().map((o) => o.title)).toEqual(['Luis', 'Mario'])

    expect(await reply(`bk:staff:${barbers[1].id}`, 'Mario')).toBe(true)
    const day = lastList()[0]
    expect(day.id).toMatch(/^bk:day:\d{4}-\d{2}-\d{2}$/)
    // A question while choosing goes to the team as usual.
    expect(await reply(null, '¿aceptan tarjeta?')).toBe(false)

    expect(await reply(day.id, day.title)).toBe(true)
    const time = lastList()[0]
    expect(time.id).toMatch(/^bk:time:\d{2}:\d{2}$/)
    expect(await reply(time.id, time.title)).toBe(true)

    const booking = await p.bookings.findFirstOrThrow({ where: { workspace_id: W, contact_id: contact.id } })
    expect(booking).toMatchObject({ source: 'picker', staff_id: barbers[1].id, service_id: service.id, customer_name: 'Ana Torres', status: 'confirmed' })
    expect(sent.at(-1)?.content.text).toContain('Corte clásico')
    expect((await p.conversations.findFirstOrThrow({ where: { id: conv.id } })).booking_picker).toBeNull()
    // An old list tapped afterwards doesn't book again.
    expect(await reply(time.id, time.title)).toBe(true)
    expect(await p.bookings.count({ where: { workspace_id: W } })).toBe(1)
  })

  it('a flow step books and continues on the "booked" exit', async () => {
    const flow = await p.flows.create({
      data: { workspace_id: W, name: 'Agendar', status: 'active', trigger_type: 'keyword', trigger_config: { keywords: ['turno'] }, entry_node_id: 'start' },
      select: { id: true },
    })
    const node = (node_key: string, node_type: string, config: object) => ({ workspace_id: W, flow_id: flow.id, node_key, node_type, config })
    await p.flow_nodes.createMany({
      data: [
        node('start', 'start', { next_node_key: 'book' }),
        node('book', 'book_appointment', { service_id: service.id, staff_id: barbers[0].id, booked_next: 'thanks', link_next: 'thanks', not_booked_next: 'human' }),
        node('thanks', 'send_message', { text: 'Gracias, te esperamos', next_node_key: 'end' }),
        node('human', 'handoff', {}),
        node('end', 'end', {}),
      ],
    })
    const out = await dispatchInboundToFlows({
      workspaceId: W,
      contactId: contact.id,
      conversationId: conv.id,
      message: { kind: 'text', text: 'quiero un turno', meta_message_id: 'wamid.in.1' },
      isFirstInboundMessage: false,
    })
    expect(out.outcome).toBe('started')
    // Service and barber fixed by the step → straight to the day.
    const day = lastList()[0]
    expect(day.id).toMatch(/^bk:day:/)
    const run = await p.flow_runs.findFirstOrThrow({ where: { flow_id: flow.id } })
    expect(run).toMatchObject({ status: 'active', current_node_key: 'book' })

    // Typed answers work too: "1" picks the first option.
    expect(await reply(null, '1')).toBe(true)
    expect(await reply(null, '1')).toBe(true)

    const booking = await p.bookings.findFirstOrThrow({ where: { workspace_id: W, source: 'flow' } })
    expect(booking.staff_id).toBe(barbers[0].id)
    expect(sent.at(-1)?.content.text).toBe('Gracias, te esperamos')
    expect(await p.flow_runs.findFirstOrThrow({ where: { id: run.id } })).toMatchObject({ status: 'completed' })
  })
})

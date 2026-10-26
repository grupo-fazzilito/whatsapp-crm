// Booking reminders end to end against a real Postgres (sending and Meta mocked).
// TEST_DATABASE_URL=postgresql://crm:crm@127.0.0.1:5434/crm npx vitest run src/lib/bookings/reminders
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { pgTest } from '@/lib/test-utils/pg'

vi.mock('server-only', () => ({}))
type Sent = { conversationId: string; content: { type: string; text?: string; options?: { id: string; title: string }[]; components?: unknown[]; templateName?: string; category?: string; sections?: { options: { id: string; title: string }[] }[] } }
const sent: Sent[] = []
vi.mock('@/lib/messaging/send', () => ({
  sendMessage: vi.fn(async (input: Sent) => {
    sent.push(input)
    return { status: 'sent', messageId: '', externalId: `wamid.${sent.length}` }
  }),
}))
const saveTemplate = vi.fn(async () => ({ ok: true, submitted: true, template: {} }))
vi.mock('@/lib/templates/server', () => ({ saveTemplate }))

const pg = await pgTest()

describe.skipIf(!pg)('booking reminders', async () => {
  if (!pg) return
  const { processBookingReminders } = await import('./server')
  const { handleReminderReply } = await import('./reminder-send')
  const { handleBookingPickerInbound } = await import('./picker')
  const { ensureReminderTemplates, REMINDER_TEMPLATE_NAME } = await import('./reminder-template')
  const p = pg.prisma
  const ws = await pg.workspace({ businessType: 'barbershop', name: 'Barbería Recordatorios' })
  const W = ws.workspaceId
  const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
  await p.workspaces.update({ where: { id: W }, data: { timezone: 'UTC', locale: 'es' } })
  await p.business_hours.deleteMany({ where: { workspace_id: W } })
  await p.business_hours.createMany({ data: DAYS.map((day_name) => ({ workspace_id: W, day_name, opening_time: '00:00', closing_time: '23:30', is_closed: false })) })
  await p.services.deleteMany({ where: { workspace_id: W } })
  await p.staff.deleteMany({ where: { workspace_id: W } })
  const service = await p.services.create({ data: { workspace_id: W, name: 'Corte clásico', duration_minutes: 30, is_active: true }, select: { id: true } })
  const barber = await p.staff.create({ data: { workspace_id: W, name: 'Mario', available_days: DAYS, available_start_time: '00:00', available_end_time: '23:30' }, select: { id: true } })
  const channel = await p.channels.create({ data: { workspace_id: W, type: 'whatsapp', name: 'WA', external_id: `pn_rem_${W}`, status: 'connected' }, select: { id: true } })
  const contact = await p.contacts.create({ data: { workspace_id: W, name: 'Ana Torres', phone: '51987000222' }, select: { id: true } })
  const conv = await p.conversations.create({ data: { workspace_id: W, contact_id: contact.id, channel_id: channel.id, last_message_at: new Date(), last_customer_message_at: new Date() }, select: { id: true } })

  const now = new Date()
  // Starts in `hours` (UTC workspace), rounded to the half hour.
  const at = (hours: number) => {
    const d = new Date(Math.round((now.getTime() + hours * 3600_000) / 1800_000) * 1800_000)
    return { booking_date: d.toISOString().slice(0, 10), booking_time: d.toISOString().slice(11, 16) }
  }
  const book = (hours: number, status = 'confirmed') =>
    p.bookings.create({ data: { workspace_id: W, contact_id: contact.id, service_id: service.id, staff_id: barber.id, ...at(hours), status, duration_minutes: 30, reminder_24h_sent: false, reminder_4h_sent: false, reminder_2h_sent: false }, select: { id: true } })
  const reminderDebits = () => p.credit_ledger.count({ where: { workspace_id: W, action: 'reminder' } })
  const mine = () => sent.filter((s) => s.conversationId === conv.id)
  const run = async () => {
    await processBookingReminders(now)
  }

  beforeEach(async () => {
    sent.length = 0
    await p.bookings.deleteMany({ where: { workspace_id: W } })
  })
  afterAll(async () => {
    await pg.cleanup(ws)
  })

  it('inside the 24 h window: text with Confirm / Change buttons, one credit, once', async () => {
    const b = await book(20)
    const before = await reminderDebits()
    await run()
    expect(mine()).toHaveLength(1)
    expect(mine()[0].content.type).toBe('buttons')
    expect(mine()[0].content.text).toContain('Corte clásico')
    expect(mine()[0].content.options?.map((o) => o.id)).toEqual([`rem:confirm:${b.id}`, `rem:change:${b.id}`])
    expect(await p.bookings.findUniqueOrThrow({ where: { id: b.id } })).toMatchObject({ reminder_24h_sent: true, reminder_error: null })
    expect(await reminderDebits()).toBe(before + 1)
    await run()
    expect(mine()).toHaveLength(1)
  })

  it('uses the business text and skips reminders turned off', async () => {
    await p.workspaces.update({ where: { id: W }, data: { settings: { booking_reminders: { off: ['4h'], texts: { '24h': 'Hola {nombre}, tu {cita} es el {fecha} a las {hora}.' } } } } })
    const b24 = await book(20)
    const b4 = await book(3)
    await run()
    expect(mine()).toHaveLength(1)
    expect(mine()[0].content.text).toMatch(/^Hola Ana Torres, tu turno es el .+ a las \d{2}:\d{2}\.$/)
    expect(await p.bookings.findUniqueOrThrow({ where: { id: b4.id } })).toMatchObject({ reminder_4h_sent: true, reminder_error: null })
    expect((await p.bookings.findUniqueOrThrow({ where: { id: b24.id } })).reminder_24h_sent).toBe(true)
    await p.workspaces.update({ where: { id: W }, data: { settings: {} } })
  })

  it('outside the window: the approved template, or the reason it could not go out', async () => {
    await p.conversations.update({ where: { id: conv.id }, data: { last_customer_message_at: new Date(now.getTime() - 3 * 86400_000) } })
    const before = await reminderDebits()
    const missing = await book(20)
    await run()
    expect(mine()).toHaveLength(0)
    expect(await p.bookings.findUniqueOrThrow({ where: { id: missing.id } })).toMatchObject({ reminder_24h_sent: true, reminder_error: 'template_missing' })

    await p.message_templates.create({ data: { workspace_id: W, name: REMINDER_TEMPLATE_NAME, language: 'es', category: 'Utility', body_text: 'x', status: 'Pending' } })
    const pending = await book(21)
    await run()
    expect((await p.bookings.findUniqueOrThrow({ where: { id: pending.id } })).reminder_error).toBe('template_pending')
    expect(await reminderDebits()).toBe(before)

    await p.message_templates.updateMany({ where: { workspace_id: W, name: REMINDER_TEMPLATE_NAME }, data: { status: 'Approved' } })
    const ok = await book(22)
    await run()
    expect(mine()).toHaveLength(1)
    const c = mine()[0].content
    expect(c).toMatchObject({ type: 'template', templateName: REMINDER_TEMPLATE_NAME, category: 'UTILITY' })
    expect(JSON.stringify(c.components)).toContain(`rem:change:${ok.id}`)
    expect(JSON.stringify(c.components)).toContain('turno de Corte clásico')
    expect(await reminderDebits()).toBe(before + 1)
    await p.conversations.update({ where: { id: conv.id }, data: { last_customer_message_at: new Date() } })
  })

  it('creates and submits the template for businesses with WhatsApp that lack it', async () => {
    await p.message_templates.deleteMany({ where: { workspace_id: W } })
    saveTemplate.mockClear()
    await ensureReminderTemplates(now)
    const call = (saveTemplate.mock.calls as unknown as [{ workspaceId: string; draft: { name: string; category: string; language: string; buttons: { text: string }[] }; submit: boolean }][]).find(([a]) => a.workspaceId === W)
    expect(call?.[0]).toMatchObject({ submit: true, draft: { name: REMINDER_TEMPLATE_NAME, category: 'Utility', language: 'es', buttons: [{ text: 'Confirmo' }, { text: 'Cambiar fecha' }] } })
  })

  it('"Confirm" confirms; "Change date" rebooks and cancels the old one', async () => {
    const b = await book(30, 'pending')
    const reply = (replyId: string) => handleReminderReply({ workspaceId: W, conversationId: conv.id, contactId: contact.id, replyId })
    expect(await reply(`rem:confirm:${b.id}`)).toBe(true)
    expect((await p.bookings.findUniqueOrThrow({ where: { id: b.id } })).status).toBe('confirmed')

    expect(await reply(`rem:change:${b.id}`)).toBe(true)
    // Service and barber come from the old booking → straight to the day.
    const pick = async () => {
      const list = [...sent].reverse().find((s) => s.content.type === 'list')!.content.sections![0].options
      const state = (await p.conversations.findUniqueOrThrow({ where: { id: conv.id }, select: { booking_picker: true } })).booking_picker
      return handleBookingPickerInbound({ workspaceId: W, conversationId: conv.id, contactId: contact.id, state, replyId: list.at(-1)!.id.startsWith('bk:time:more') ? list[0].id : list[list.length > 1 ? 1 : 0].id, text: '' })
    }
    expect(await pick()).toBe(true) // day
    expect(await pick()).toBe(true) // time
    const rows = await p.bookings.findMany({ where: { workspace_id: W }, select: { id: true, status: true, source: true } })
    expect(rows.find((r) => r.id === b.id)?.status).toBe('cancelled')
    expect(rows.filter((r) => r.source === 'picker' && r.status === 'confirmed')).toHaveLength(1)
    expect(sent.at(-1)?.content.text).toContain('cambiamos la fecha')
  })
})

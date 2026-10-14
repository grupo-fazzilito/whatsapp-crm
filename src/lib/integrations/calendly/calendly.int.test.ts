// Calendly end to end against a real Postgres, with Calendly's API faked
// on fetch. TEST_DATABASE_URL=postgresql://crm:crm@127.0.0.1:5434/crm npx vitest run src/lib/integrations/calendly
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { pgTest } from '@/lib/test-utils/pg'
import type { BookingDraft } from '@/lib/ai/types'

vi.mock('server-only', () => ({}))
const pg = await pgTest()

const MOCK = 'http://calendly.mock'
const ET = `${MOCK}/event_types/ET1`
const USER = `${MOCK}/users/U1`

/** Fake Calendly: state the tests can steer. */
const fake = {
  planAllowsBooking: true,
  invitees: [] as Record<string, unknown>[],
  cancelled: [] as string[],
  refreshes: 0,
  slots: [] as string[],
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

async function calendly(url: URL, init?: RequestInit): Promise<Response> {
  const path = url.pathname
  if (path === '/oauth/token') {
    const p = new URLSearchParams(String(init?.body))
    if (p.get('grant_type') === 'refresh_token') fake.refreshes++
    return json({ access_token: `at-${Date.now()}`, refresh_token: `rt-${Math.random()}`, expires_in: 7200, owner: USER, organization: `${MOCK}/organizations/O1` })
  }
  if (path === '/users/me') return json({ resource: { uri: USER, name: 'Clínica Demo', email: 'agenda@clinica.pe', scheduling_url: 'https://calendly.com/clinica', timezone: 'America/Lima', current_organization: `${MOCK}/organizations/O1` } })
  if (path === '/event_types') return json({ collection: [{ uri: ET, name: 'Consulta 30 min', active: true, duration: 30, scheduling_url: 'https://calendly.com/clinica/30min', locations: [{ kind: 'google_conference' }] }], pagination: {} })
  if (path === '/event_type_available_times') {
    return json({ collection: fake.slots.map((s) => ({ status: 'available', start_time: s, invitees_remaining: 1, scheduling_url: `https://calendly.com/clinica/30min/${s}` })) })
  }
  if (path === '/invitees' && init?.method === 'POST') {
    if (!fake.planAllowsBooking) return json({ title: 'Permission Denied', message: 'Please upgrade your Calendly account' }, 403)
    const body = JSON.parse(String(init.body))
    fake.invitees.push(body)
    return json({ resource: { uri: `${MOCK}/scheduled_events/EV-API/invitees/INV-API`, event: `${MOCK}/scheduled_events/EV-API`, cancel_url: 'https://calendly.com/cancellations/INV-API', reschedule_url: 'https://calendly.com/reschedulings/INV-API' } }, 201)
  }
  if (path.startsWith('/scheduled_events/') && path.endsWith('/cancellation')) {
    fake.cancelled.push(path)
    return json({ resource: {} }, 201)
  }
  if (path.startsWith('/scheduled_events/') && !path.includes('/invitees')) {
    return json({ resource: { uri: `${MOCK}${path}`, status: 'active', start_time: '2026-10-20T14:30:00Z', end_time: '2026-10-20T15:00:00Z', event_type: ET } })
  }
  return json({ message: `unhandled ${path}` }, 404)
}

describe.skipIf(!pg)('Calendly integration', async () => {
  if (!pg) return
  process.env.CALENDLY_API_MOCK_URL = MOCK
  process.env.CALENDLY_CLIENT_ID = 'cid'
  process.env.CALENDLY_CLIENT_SECRET = 'csecret'
  const realFetch = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (href.startsWith(MOCK)) return calendly(new URL(href), init)
    return realFetch(input, init)
  })

  const { completeCalendlyConnect, handleWebhook, pushCancellations, disconnectCalendly } = await import('./sync')
  const { createBookingFromDraft } = await import('@/lib/ai/bookings')
  const { invalidateBusinessContext } = await import('@/lib/ai/context')
  const ws = await pg.workspace({ businessType: 'barbershop' })
  let serviceId = ''
  let contactId = ''
  // A weekday two weeks ahead, 09:30 in the workspace time zone.
  const day = new Date(Date.now() + 14 * 86400_000).toISOString().slice(0, 10)

  beforeAll(async () => {
    await pg.prisma.workspaces.update({ where: { id: ws.workspaceId }, data: { timezone: 'America/Lima' } })
    const svc = await ws.db.services.create({ data: { workspace_id: ws.workspaceId, name: 'Consulta', duration_minutes: 30, is_active: true }, select: { id: true } })
    serviceId = svc.id
    const c = await ws.db.contacts.create({ data: { workspace_id: ws.workspaceId, name: 'Ana Pérez', phone: '+51999000111' }, select: { id: true } })
    contactId = c.id
    fake.slots = [`${day}T14:30:00Z`, `${day}T15:00:00Z`]
  })
  afterAll(async () => {
    vi.restoreAllMocks()
    await pg.cleanup(ws)
  })

  it('connects, stores encrypted tokens and the event types', async () => {
    await completeCalendlyConnect({ workspaceId: ws.workspaceId, userId: ws.userId, code: 'code-1' })
    const conn = await pg.prisma.calendly_connections.findUniqueOrThrow({ where: { workspace_id: ws.workspaceId }, include: { calendly_connection_secrets: true } })
    expect(conn).toMatchObject({ email: 'agenda@clinica.pe', user_uri: USER, status: 'active' })
    expect(conn.calendly_connection_secrets?.access_token).not.toMatch(/^at-/)
    const types = await pg.prisma.calendly_event_types.findMany({ where: { workspace_id: ws.workspaceId } })
    expect(types).toHaveLength(1)
    expect(types[0]).toMatchObject({ uri: ET, name: 'Consulta 30 min', duration_minutes: 30, locations: ['google_conference'] })
    await pg.prisma.calendly_event_types.update({ where: { id: types[0].id }, data: { service_id: serviceId } })
    invalidateBusinessContext(ws.workspaceId)
  })

  const draft = (time: string, email?: string): BookingDraft => ({ service_id: serviceId, date: day, time, customer_name: 'Ana Pérez', fields: email ? { email } : {} })
  const book = (d: ReturnType<typeof draft>) => createBookingFromDraft({ workspaceId: ws.workspaceId, contactId, conversationId: null, aiAgentId: null, draft: d, source: 'ai' })

  it('asks for the email, then offers the free times when the slot is taken', async () => {
    expect(await book(draft('09:30'))).toMatchObject({ ok: false, reason: 'missing', missing: ['email'] })
    expect(await book(draft('11:00', 'ana@mail.pe'))).toMatchObject({ ok: false, reason: 'slot_taken', alternatives: ['09:30', '10:00'] })
  })

  it('books directly in Calendly and records the booking', async () => {
    const r = await book(draft('09:30', 'ana@mail.pe'))
    expect(r).toMatchObject({ ok: true, serviceName: 'Consulta' })
    expect(fake.invitees.at(-1)).toMatchObject({ event_type: ET, start_time: `${day}T14:30:00Z`, invitee: { name: 'Ana Pérez', email: 'ana@mail.pe', timezone: 'America/Lima' }, location: { kind: 'google_conference' } })
    const b = await ws.db.bookings.findFirstOrThrow({ where: { id: (r as { bookingId: string }).bookingId } })
    expect(b).toMatchObject({ booking_time: '09:30', status: 'confirmed', calendly_invitee_uri: `${MOCK}/scheduled_events/EV-API/invitees/INV-API` })
    expect((await ws.db.contacts.findFirstOrThrow({ where: { id: contactId } })).email).toBe('ana@mail.pe')
    expect((await pg.prisma.calendly_connections.findUniqueOrThrow({ where: { workspace_id: ws.workspaceId } })).can_book).toBe(true)
  })

  it('sends the booking link when the plan cannot book by API, and remembers it', async () => {
    fake.planAllowsBooking = false
    const r = await book(draft('10:00', 'ana@mail.pe'))
    expect(r).toMatchObject({ ok: false, reason: 'link' })
    expect((r as { url: string }).url).toBe(`https://calendly.com/clinica/30min/${day}T15:00:00Z?name=Ana+P%C3%A9rez&email=ana%40mail.pe`)
    expect((await pg.prisma.calendly_connections.findUniqueOrThrow({ where: { workspace_id: ws.workspaceId } })).can_book).toBe(false)
    invalidateBusinessContext(ws.workspaceId)
    // Next time no email is needed: the link goes out straight away.
    expect(await book(draft('10:00'))).toMatchObject({ ok: false, reason: 'link' })
  })

  it('records bookings and cancellations made in Calendly (webhook), once', async () => {
    const payload = {
      uri: `${MOCK}/scheduled_events/EV-EXT/invitees/INV-EXT`, email: 'luis@mail.pe', name: 'Luis Rojas', status: 'active', text_reminder_number: '+51 988 777 666',
      cancel_url: 'https://calendly.com/cancellations/INV-EXT', reschedule_url: null,
      scheduled_event: { uri: `${MOCK}/scheduled_events/EV-EXT`, start_time: `${day}T16:00:00Z`, end_time: `${day}T16:30:00Z`, event_type: ET },
    }
    expect(await handleWebhook({ event: 'invitee.created', payload } as never)).toEqual({ ok: true })
    await handleWebhook({ event: 'invitee.created', payload } as never)
    const rows = await ws.db.bookings.findMany({ where: { calendly_invitee_uri: payload.uri } })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ booking_time: '11:00', service_id: serviceId, source: 'calendly', status: 'confirmed', customer_name: 'Luis Rojas' })
    const contact = await ws.db.contacts.findFirstOrThrow({ where: { id: rows[0].contact_id } })
    expect(contact).toMatchObject({ name: 'Luis Rojas', email: 'luis@mail.pe', phone: '+51988777666' })

    await handleWebhook({ event: 'invitee.canceled', payload: { ...payload, status: 'canceled' } } as never)
    const after = await ws.db.bookings.findFirstOrThrow({ where: { id: rows[0].id } })
    expect(after.status).toBe('cancelled')
    // Cancelled in Calendly: nothing to push back.
    expect(after.calendly_cancel_synced_at).not.toBeNull()
  })

  it('sends cancellations made in Whasalia to Calendly', async () => {
    const ours = await ws.db.bookings.findFirstOrThrow({ where: { calendly_invitee_uri: `${MOCK}/scheduled_events/EV-API/invitees/INV-API` } })
    await ws.db.bookings.update({ where: { id: ours.id }, data: { status: 'cancelled' } })
    await pushCancellations(ws.workspaceId)
    expect(fake.cancelled).toEqual(['/scheduled_events/EV-API/cancellation'])
    expect((await ws.db.bookings.findFirstOrThrow({ where: { id: ours.id } })).calendly_cancel_synced_at).not.toBeNull()
    await pushCancellations(ws.workspaceId)
    expect(fake.cancelled).toHaveLength(1)
  })

  it('ignores webhooks for event types no workspace has', async () => {
    expect(await handleWebhook({ event: 'invitee.created', payload: { uri: 'x', scheduled_event: { uri: 'y', start_time: '', end_time: '', event_type: `${MOCK}/event_types/NOPE` } } } as never)).toEqual({ ok: false, reason: 'unknown_event_type' })
  })

  it('disconnects without touching the bookings', async () => {
    const before = await ws.db.bookings.count()
    await disconnectCalendly(ws.workspaceId)
    expect(await pg.prisma.calendly_connections.count({ where: { workspace_id: ws.workspaceId } })).toBe(0)
    expect(await pg.prisma.calendly_event_types.count({ where: { workspace_id: ws.workspaceId } })).toBe(0)
    expect(await ws.db.bookings.count()).toBe(before)
  })
})

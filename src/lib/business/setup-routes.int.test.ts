// Business-setup and bookings API routes against a real PostgreSQL:
//   TEST_DATABASE_URL=postgresql://crm:crm@127.0.0.1:5434/crm npx vitest run src/lib/business
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { pgTest } from '@/lib/test-utils/pg'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/workspace/context', () => ({ requireWorkspace: vi.fn() }))
vi.mock('@/lib/ai/context', () => ({ invalidateBusinessContext: vi.fn() }))
vi.mock('@/lib/storage', () => ({ removeObjects: vi.fn(async () => undefined) }))

const pg = await pgTest()

describe.skipIf(!pg)('business setup routes on PostgreSQL', async () => {
  const { requireWorkspace } = await import('@/lib/workspace/context')
  const { invalidateBusinessContext } = await import('@/lib/ai/context')
  const { removeObjects } = await import('@/lib/storage')
  const staffRoute = await import('@/app/api/business/staff/route')
  const staffIdRoute = await import('@/app/api/business/staff/[id]/route')
  const hoursRoute = await import('@/app/api/business/hours/route')
  const wsRoute = await import('@/app/api/business/workspace/route')
  const pmRoute = await import('@/app/api/business/payment-methods/route')
  const pmIdRoute = await import('@/app/api/business/payment-methods/[id]/route')
  const pmReorder = await import('@/app/api/business/payment-methods/reorder/route')
  const bookingsRoute = await import('@/app/api/bookings/route')
  const bookingIdRoute = await import('@/app/api/bookings/[id]/route')
  const intakeRoute = await import('@/app/api/bookings/[id]/intake/route')

  type Made = Awaited<ReturnType<NonNullable<typeof pg>['workspace']>>
  let a: Made
  let b: Made

  function as(ws: Made, role: 'agent' | 'admin' = 'admin') {
    vi.mocked(requireWorkspace).mockImplementation(async (min = 'agent') => {
      if (min === 'admin' && role === 'agent') {
        return { ok: false, response: Response.json({ error: 'Forbidden' }, { status: 403 }) } as never
      }
      return { ok: true, ctx: { user: { id: ws.userId }, workspace: { id: ws.workspaceId }, role, db: ws.db } } as never
    })
  }
  const json = (method: string, body: unknown) =>
    new Request('http://local/x', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const params = (id: string) => ({ params: Promise.resolve({ id }) })

  beforeAll(async () => {
    a = await pg!.workspace({ businessType: 'clinic' })
    b = await pg!.workspace()
  })
  afterAll(async () => {
    await pg!.cleanup(a, b)
    await pg!.prisma.$disconnect()
  })

  it('staff: creates with linked services, re-syncs them, rejects foreign ids and agents', async () => {
    const s1 = await a.db.services.create({ data: { name: 'S1', workspace_id: a.workspaceId } })
    const s2 = await a.db.services.create({ data: { name: 'S2', workspace_id: a.workspaceId } })
    const foreign = await b.db.services.create({ data: { name: 'B', workspace_id: b.workspaceId } })

    as(a)
    let res = await staffRoute.POST(json('POST', { name: 'Ana', available_days: ['Monday'], service_ids: [s1.id] }))
    expect(res.status).toBe(200)
    const { id } = await res.json()
    expect(vi.mocked(invalidateBusinessContext)).toHaveBeenCalledWith(a.workspaceId)

    res = await staffIdRoute.PATCH(json('PATCH', { title: 'Dr', service_ids: [s2.id] }), params(id))
    expect(res.status).toBe(200)
    const links = await a.db.staff_services.findMany({ where: { staff_id: id } })
    expect(links.map((l) => l.service_id)).toEqual([s2.id])

    res = await staffIdRoute.PATCH(json('PATCH', { service_ids: [foreign.id] }), params(id))
    expect(res.status).toBe(400)
    res = await staffIdRoute.PATCH(json('PATCH', { member_user_id: b.userId }), params(id))
    expect(res.status).toBe(400)

    const list = await (await staffRoute.GET()).json()
    expect(list.staff.map((s: { name: string }) => s.name)).toEqual(['Ana'])
    expect(list.links).toEqual([{ staff_id: id, service_id: s2.id }])

    as(a, 'agent')
    expect((await staffIdRoute.DELETE(new Request('http://local/x'), params(id))).status).toBe(403)
    as(b)
    expect((await staffIdRoute.DELETE(new Request('http://local/x'), params(id))).status).toBe(404)
    as(a)
    expect((await staffIdRoute.DELETE(new Request('http://local/x'), params(id))).status).toBe(200)
  })

  it('hours: upserts one row per day', async () => {
    as(a)
    const day = { day_name: 'Monday', opening_time: '08:00', closing_time: '17:00', is_closed: false, break_start: null, break_end: null }
    expect((await hoursRoute.PUT(json('PUT', { hours: [day] }))).status).toBe(200)
    expect((await hoursRoute.PUT(json('PUT', { hours: [{ ...day, closing_time: '19:00' }] }))).status).toBe(200)
    const { hours } = await (await hoursRoute.GET()).json()
    expect(hours.filter((h: { day_name: string }) => h.day_name === 'Monday')).toEqual([{ ...day, closing_time: '19:00' }])
  })

  it('workspace: updates profile columns and merges settings', async () => {
    as(a)
    await pg!.prisma.workspaces.update({ where: { id: a.workspaceId }, data: { settings: { keep: 1, orders: { fulfillment: ['pickup'] } } } })
    const res = await wsRoute.PATCH(json('PATCH', { name: 'Clinic A', settings: { orders: { delivery_fee: 3 }, booking_capacity: 2 } }))
    expect(res.status).toBe(200)
    const ws = await pg!.prisma.workspaces.findUniqueOrThrow({ where: { id: a.workspaceId } })
    expect(ws.name).toBe('Clinic A')
    expect(ws.settings).toEqual({ keep: 1, orders: { fulfillment: ['pickup'], delivery_fee: 3 }, booking_capacity: 2 })
    expect((await wsRoute.PATCH(json('PATCH', { slug: 'x' }))).status).toBe(400)
  })

  it('payment methods: QR urls must be own uploads; replaced files are removed; reorder', async () => {
    as(a)
    const own = `/api/files/catalog/${a.workspaceId}/payments/q1.png`
    const foreign = `/api/files/catalog/${b.workspaceId}/payments/q.png`
    expect((await pmRoute.POST(json('POST', { name: 'Nequi', type: 'qr', qr_image_url: foreign }))).status).toBe(400)
    let res = await pmRoute.POST(json('POST', { name: 'Nequi', type: 'qr', qr_image_url: own }))
    const first = (await res.json()).method
    expect(first.sort_order).toBe(0)
    res = await pmRoute.POST(json('POST', { name: 'Cash', type: 'cash' }))
    const second = (await res.json()).method
    expect(second.sort_order).toBe(1)

    const next = `/api/files/catalog/${a.workspaceId}/payments/q2.png`
    expect((await pmIdRoute.PATCH(json('PATCH', { qr_image_url: next }), params(first.id))).status).toBe(200)
    expect(vi.mocked(removeObjects)).toHaveBeenCalledWith('catalog', [`${a.workspaceId}/payments/q1.png`])

    expect((await pmReorder.POST(json('POST', { ids: [second.id, first.id] }))).status).toBe(200)
    const { methods } = await (await pmRoute.GET()).json()
    expect(methods.map((m: { name: string }) => m.name)).toEqual(['Cash', 'Nequi'])

    vi.mocked(removeObjects).mockClear()
    expect((await pmIdRoute.DELETE(new Request('http://local/x'), params(first.id))).status).toBe(200)
    expect(vi.mocked(removeObjects)).toHaveBeenCalledWith('catalog', [`${a.workspaceId}/payments/q2.png`])
  })

  it('bookings: scoped references, reminder reset on reschedule, intake attach', async () => {
    const contact = await a.db.contacts.create({ data: { name: 'Pat', phone: '+570000001', workspace_id: a.workspaceId } })
    const foreignContact = await b.db.contacts.create({ data: { name: 'Other', phone: '+570000002', workspace_id: b.workspaceId } })
    as(a, 'agent')
    const base = { contact_id: contact.id, booking_date: '2030-01-10', booking_time: '10:00', duration_minutes: 30, status: 'confirmed' }
    expect((await bookingsRoute.POST(json('POST', { ...base, contact_id: foreignContact.id }))).status).toBe(400)
    const res = await bookingsRoute.POST(json('POST', base))
    expect(res.status).toBe(200)
    const { id } = await res.json()

    await a.db.bookings.updateMany({ where: { id }, data: { reminder_24h_sent: true } })
    expect((await bookingIdRoute.PATCH(json('PATCH', { status: 'pending' }), params(id))).status).toBe(200)
    expect((await a.db.bookings.findFirstOrThrow({ where: { id } })).reminder_24h_sent).toBe(true)
    expect((await bookingIdRoute.PATCH(json('PATCH', { booking_time: '11:00' }), params(id))).status).toBe(200)
    expect((await a.db.bookings.findFirstOrThrow({ where: { id } })).reminder_24h_sent).toBe(false)

    const day = await (await bookingsRoute.GET(new Request('http://local/api/bookings?date=2030-01-10&active=1'))).json()
    expect(day.bookings).toHaveLength(1)
    const all = await (await bookingsRoute.GET(new Request('http://local/api/bookings'))).json()
    expect(all.bookings[0].contact).toEqual({ id: contact.id, name: 'Pat', phone: '+570000001' })

    const loose = await a.db.patient_intake.create({ data: { contact_id: contact.id, symptoms: 'cough', workspace_id: a.workspaceId } })
    const got = await (await intakeRoute.GET(new Request('http://local/x'), params(id))).json()
    expect(got.intake.id).toBe(loose.id)
    expect(got.intake.booking_id).toBe(id)

    as(b, 'agent')
    expect((await bookingIdRoute.DELETE(new Request('http://local/x'), params(id))).status).toBe(404)
    as(a, 'agent')
    expect((await bookingIdRoute.DELETE(new Request('http://local/x'), params(id))).status).toBe(200)
  })
})

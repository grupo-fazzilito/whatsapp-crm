// Inbox / CRM API routes ported from Supabase to Prisma, against a real PostgreSQL:
//   TEST_DATABASE_URL=postgresql://crm:crm@127.0.0.1:5434/crm npx vitest run src/lib/inbox/inbox-routes.int.test.ts
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { pgTest } from '@/lib/test-utils/pg'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/workspace/context', () => ({ requireWorkspace: vi.fn() }))
vi.mock('@/lib/admin/guard', () => ({ isPlatformAdmin: vi.fn(async () => true) }))

const pg = await pgTest()

describe.skipIf(!pg)('inbox routes on PostgreSQL', async () => {
  const { requireWorkspace } = await import('@/lib/workspace/context')
  const { isPlatformAdmin } = await import('@/lib/admin/guard')
  const quickReplies = await import('@/app/api/quick-replies/route')
  const notifications = await import('@/app/api/notifications/route')
  const conversation = await import('@/app/api/conversations/[id]/route')
  const transfer = await import('@/app/api/conversations/[id]/transfer/route')
  const dealStatus = await import('@/app/api/deals/[id]/status/route')
  const flowRuns = await import('@/app/api/flows/[id]/runs/route')
  const captures = await import('@/app/api/captures/route')
  const channels = await import('@/app/api/channels/route')
  const portfolio = await import('@/app/api/admin/portfolio/route')

  type Made = Awaited<ReturnType<NonNullable<typeof pg>['workspace']>>
  let a: Made
  let a2: { userId: string } // second member of workspace a
  let b: Made
  const portfolioIds: string[] = []

  function as(ws: Made, role: 'agent' | 'admin' = 'admin', userId = ws.userId) {
    vi.mocked(requireWorkspace).mockImplementation(async (min = 'agent') => {
      if (min === 'admin' && role === 'agent') {
        return { ok: false, response: Response.json({ error: 'Forbidden' }, { status: 403 }) } as never
      }
      return { ok: true, ctx: { user: { id: userId }, workspace: { id: ws.workspaceId, locale: 'es' }, role, db: ws.db } } as never
    })
  }
  const json = (method: string, body: unknown) =>
    new Request('http://local/x', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const params = (id: string) => ({ params: Promise.resolve({ id }) })

  beforeAll(async () => {
    a = await pg!.workspace()
    b = await pg!.workspace()
    const u = await pg!.prisma.users.create({ data: { email: `t-${crypto.randomUUID()}@test.local`, meta: {} } })
    await pg!.prisma.workspace_members.create({ data: { workspace_id: a.workspaceId, user_id: u.id, role: 'agent', status: 'active' } })
    a2 = { userId: u.id }
  })
  afterAll(async () => {
    await pg!.prisma.portfolio_items.deleteMany({ where: { id: { in: portfolioIds } } })
    await pg!.cleanup(a, b)
    await pg!.prisma.users.deleteMany({ where: { id: a2.userId } })
    await pg!.prisma.$disconnect()
  })

  it('quick replies: shared + own only, 409 on taken shortcut, agents cannot share', async () => {
    await a.db.quick_replies.create({ data: { workspace_id: a.workspaceId, shortcut: 'other', title: 'x', body: 'x', is_shared: false, created_by: a2.userId } })
    as(a)
    let res = await quickReplies.POST(json('POST', { shortcut: 'hola', title: 'Hola', body: 'Hola!' }))
    expect(res.status).toBe(200)
    expect((await res.json()).quick_reply).toMatchObject({ shortcut: 'hola', is_shared: true, created_by: a.userId, attachments: [] })
    res = await quickReplies.POST(json('POST', { shortcut: 'hola', title: 'Again', body: 'x' }))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'shortcut_taken' })

    as(a, 'agent', a2.userId)
    expect((await quickReplies.POST(json('POST', { shortcut: 'mine', title: 'M', body: 'm', is_shared: true }))).status).toBe(403)
    expect((await quickReplies.POST(json('POST', { shortcut: 'mine', title: 'M', body: 'm' }))).status).toBe(200)

    as(a) // admin sees shared + own, not a2's personal ones
    const list = (await (await quickReplies.GET()).json()).quick_replies as { shortcut: string }[]
    expect(list.map((r) => r.shortcut)).toEqual(['hola'])
    as(a, 'agent', a2.userId)
    const list2 = (await (await quickReplies.GET()).json()).quick_replies as { shortcut: string }[]
    expect(list2.map((r) => r.shortcut)).toEqual(['hola', 'mine', 'other'])
    as(b)
    expect((await (await quickReplies.GET()).json()).quick_replies).toEqual([])
  })

  it('notifications: own only, mark read by ids or all', async () => {
    const mk = (userId: string, title: string) =>
      a.db.notifications.create({ data: { workspace_id: a.workspaceId, user_id: userId, type: 'assigned', title } })
    const n1 = await mk(a.userId, 'one')
    await mk(a.userId, 'two')
    await mk(a2.userId, 'not mine')
    as(a)
    let body = await (await notifications.GET(new Request('http://local/x?limit=10'))).json()
    expect(body.notifications.map((n: { title: string }) => n.title).sort()).toEqual(['one', 'two'])
    expect(body.unread).toBe(2)
    expect((await notifications.PATCH(json('PATCH', { ids: ['nope'] }))).status).toBe(400)
    body = await (await notifications.PATCH(json('PATCH', { ids: [n1.id] }))).json()
    expect(body).toEqual({ ok: true, unread: 1 })
    body = await (await notifications.PATCH(json('PATCH', { all: true }))).json()
    expect(body).toEqual({ ok: true, unread: 0 })
    expect(await a.db.notifications.count({ where: { user_id: a2.userId, read_at: null } })).toBe(1)
  })

  it('conversations: patch status/assignee, transfer, workspace isolation', async () => {
    const contact = await a.db.contacts.create({ data: { workspace_id: a.workspaceId, name: 'Cliente', phone: '+5491100000001' } })
    const conv = await a.db.conversations.create({ data: { workspace_id: a.workspaceId, contact_id: contact.id } })
    as(a)
    let res = await conversation.PATCH(json('PATCH', { status: 'closed', priority: 'high' }), params(conv.id))
    expect(res.status).toBe(200)
    const { conversation: c } = await res.json()
    expect(c).toMatchObject({ id: conv.id, status: 'closed', priority: 'high', resolved_by: a.userId })
    expect(typeof c.resolved_at).toBe('string')

    expect((await conversation.PATCH(json('PATCH', { assigned_agent_id: b.userId }), params(conv.id))).status).toBe(400)
    res = await conversation.PATCH(json('PATCH', { assigned_agent_id: a2.userId }), params(conv.id))
    expect((await res.json()).conversation.assigned_agent_id).toBe(a2.userId)
    expect(await a.db.notifications.count({ where: { user_id: a2.userId, conversation_id: conv.id } })).toBe(1)

    res = await transfer.POST(json('POST', { to_user_id: a.userId, reason: 'vacaciones' }), params(conv.id))
    expect(res.status).toBe(200)
    const t = await res.json()
    expect(t.assigned_to).toBe(a.userId)
    expect(t.conversation).toMatchObject({ status: 'open', resolved_at: null, assigned_agent_id: a.userId })
    expect((await transfer.POST(json('POST', { to_user_id: b.userId }), params(conv.id))).status).toBe(400)

    as(b)
    expect((await conversation.PATCH(json('PATCH', { status: 'open' }), params(conv.id))).status).toBe(404)
    expect((await transfer.POST(json('POST', { to_user_id: b.userId }), params(conv.id))).status).toBe(404)
  })

  it('deals: status change stamps won_at, foreign deal is 404', async () => {
    const pipeline = await a.db.pipelines.create({ data: { workspace_id: a.workspaceId, name: 'P' } })
    const stage = await a.db.pipeline_stages.create({ data: { workspace_id: a.workspaceId, pipeline_id: pipeline.id, name: 'S' } })
    const deal = await a.db.deals.create({ data: { workspace_id: a.workspaceId, pipeline_id: pipeline.id, stage_id: stage.id, title: 'D' } })
    const ctx = (id: string) => ({ params: Promise.resolve({ id }) }) as never
    as(a, 'agent')
    expect((await dealStatus.POST(json('POST', { status: 'lost' }), ctx(deal.id))).status).toBe(400)
    const res = await dealStatus.POST(json('POST', { status: 'won', note: 'ok' }), ctx(deal.id))
    expect(res.status).toBe(200)
    const { deal: d } = await res.json()
    expect(Object.keys(d).sort()).toEqual(['close_note', 'id', 'lost_at', 'lost_reason', 'status', 'won_at'])
    expect(d).toMatchObject({ id: deal.id, status: 'won', close_note: 'ok' })
    expect(typeof d.won_at).toBe('string')
    as(b, 'agent')
    expect((await dealStatus.POST(json('POST', { status: 'won' }), ctx(deal.id))).status).toBe(404)
  })

  it('flow runs: runs with contact alias and events; 404 for foreign or bad ids', async () => {
    const contact = await a.db.contacts.create({ data: { workspace_id: a.workspaceId, name: 'Run', phone: '+5491100000002' } })
    const flow = await a.db.flows.create({ data: { workspace_id: a.workspaceId, name: 'F', trigger_type: 'manual' } })
    const run = await a.db.flow_runs.create({ data: { workspace_id: a.workspaceId, flow_id: flow.id, contact_id: contact.id, status: 'completed' } })
    await a.db.flow_run_events.create({ data: { workspace_id: a.workspaceId, flow_run_id: run.id, event_type: 'started', payload: {} } })
    as(a, 'agent')
    const body = await (await flowRuns.GET(new Request('http://local/x'), params(flow.id))).json()
    expect(body.flow).toEqual({ id: flow.id, name: 'F' })
    expect(body.runs).toHaveLength(1)
    expect(body.runs[0].contact).toEqual({ id: contact.id, name: 'Run', phone: '+5491100000002' })
    expect(body.runs[0]).not.toHaveProperty('contacts')
    expect(body.events).toMatchObject([{ flow_run_id: run.id, event_type: 'started' }])
    expect((await flowRuns.GET(new Request('http://local/x'), params('nope'))).status).toBe(404)
    as(b, 'agent')
    expect((await flowRuns.GET(new Request('http://local/x'), params(flow.id))).status).toBe(404)
  })

  it('captures: search, mine filter, contact alias', async () => {
    const contact = await a.db.contacts.create({ data: { workspace_id: a.workspaceId, name: 'Dueño', phone: '+5491100000003' } })
    await a.db.property_captures.create({ data: { workspace_id: a.workspaceId, owner_name: 'María Pérez', district: 'Miraflores', contact_id: contact.id, assigned_user_id: a.userId } })
    await a.db.property_captures.create({ data: { workspace_id: a.workspaceId, owner_name: 'Otro', address: 'Av. Siempre Viva' } })
    as(a, 'agent')
    let body = await (await captures.GET(new Request('http://local/x?q=mirafl'))).json()
    expect(body.captures).toHaveLength(1)
    expect(body.captures[0]).toMatchObject({ owner_name: 'María Pérez', contact: { id: contact.id, name: 'Dueño' }, cover: null })
    body = await (await captures.GET(new Request('http://local/x?mine=1'))).json()
    expect(body.captures).toHaveLength(1)
    body = await (await captures.GET(new Request('http://local/x'))).json()
    expect(body.captures).toHaveLength(2)
    as(b, 'agent')
    expect((await (await captures.GET(new Request('http://local/x'))).json()).captures).toEqual([])
  })

  it('channels: lists only public columns of the workspace', async () => {
    await a.db.channels.create({ data: { workspace_id: a.workspaceId, type: 'webchat', name: 'Web', external_id: `wk_${crypto.randomUUID()}` } })
    as(a, 'agent')
    const body = await (await channels.GET()).json()
    expect(body.channels.map((c: { name: string }) => c.name)).toContain('Web')
    for (const c of body.channels) expect(c.workspace_id).toBe(a.workspaceId)
    expect(body.features).toBeDefined()
  })

  it('admin portfolio: CRUD for platform admins only', async () => {
    let res: Response = await portfolio.POST(json('POST', { title: 'Demo', metadata_tags: ['next'] }) as never)
    const { item } = await res.json()
    portfolioIds.push(item.id)
    expect(item).toMatchObject({ title: 'Demo', description: null, metadata_tags: ['next'], project_links: {}, preview_media: [] })
    res = await portfolio.PUT(json('PUT', { id: item.id, title: 'Demo 2' }) as never)
    expect((await res.json()).item.title).toBe('Demo 2')
    const list = await (await portfolio.GET()).json()
    expect(list.db_fallback).toBe(false)
    expect(list.items.some((i: { id: string }) => i.id === item.id)).toBe(true)
    res = await portfolio.DELETE(new Request(`http://local/x?id=${item.id}`) as never)
    expect(await res.json()).toEqual({ ok: true })
    expect(await pg!.prisma.portfolio_items.count({ where: { id: item.id } })).toBe(0)

    vi.mocked(isPlatformAdmin).mockResolvedValueOnce(false)
    expect((await portfolio.GET()).status).toBe(401)
  })
})

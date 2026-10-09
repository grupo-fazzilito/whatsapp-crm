// CRM helpers against a real PostgreSQL:
//   TEST_DATABASE_URL=postgresql://crm:crm@127.0.0.1:5434/crm npx vitest run src/lib/crm
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { pgTest } from '@/lib/test-utils/pg'

vi.mock('server-only', () => ({}))

const pg = await pgTest()

describe.skipIf(!pg)('CRM server helpers on PostgreSQL', async () => {
  const { parseTaskInput, parseDealInput, listTasks, contactDeals, owns, memberProfiles, TASK_INCLUDE, taskRow } = await import('./server')
  let a: Awaited<ReturnType<NonNullable<typeof pg>['workspace']>>
  let b: Awaited<ReturnType<NonNullable<typeof pg>['workspace']>>
  let contactA = ''
  let contactB = ''

  beforeAll(async () => {
    a = await pg!.workspace()
    b = await pg!.workspace()
    contactA = (await a.db.contacts.create({ data: { workspace_id: a.workspaceId, phone: '+51911', name: 'Ana' } })).id
    contactB = (await b.db.contacts.create({ data: { workspace_id: b.workspaceId, phone: '+51922', name: 'Beto' } })).id
  })
  afterAll(() => pg!.cleanup(a, b))

  it('only accepts links to rows and members of the same workspace', async () => {
    expect(await owns(a.db, 'contacts', contactA)).toBe(true)
    expect(await owns(a.db, 'contacts', contactB)).toBe(false)
    expect(await owns(a.db, 'contacts', 'nope')).toBe(false)

    expect(await parseTaskInput(a.db, { title: '  Llamar  ', contact_id: contactA, assignee_user_id: a.userId, priority: 'high' }, 'create')).toEqual({
      ok: true,
      data: { title: 'Llamar', contact_id: contactA, assignee_user_id: a.userId, priority: 'high' },
    })
    expect(await parseTaskInput(a.db, { title: 'x', contact_id: contactB }, 'create')).toEqual({ ok: false, error: 'invalid_contact_id' })
    expect(await parseTaskInput(a.db, { title: 'x', assignee_user_id: b.userId }, 'create')).toEqual({ ok: false, error: 'invalid_assignee_user_id' })
    expect(await parseTaskInput(a.db, {}, 'create')).toEqual({ ok: false, error: 'title_required' })
    expect(await parseTaskInput(a.db, { status: 'done' }, 'update')).toEqual({ ok: false, error: 'invalid_status' })
    expect(await parseTaskInput(a.db, { status: 'open', result: null, contact_id: null }, 'update')).toEqual({
      ok: true,
      data: { status: 'open', result: null, contact_id: null },
    })
  })

  it('validates deal stage/pipeline pairs and owners', async () => {
    const pipeline = async (w: typeof a) => {
      const p = await w.db.pipelines.create({ data: { workspace_id: w.workspaceId, name: 'Ventas' } })
      const stages = []
      for (const [i, name] of ['Nuevo', 'Propuesta'].entries()) {
        stages.push(await w.db.pipeline_stages.create({ data: { workspace_id: w.workspaceId, pipeline_id: p.id, name, position: i } }))
      }
      return { ...p, pipeline_stages: stages }
    }
    const pa = await pipeline(a)
    const pb = await pipeline(b)
    const owners = await memberProfiles(a.db)
    expect(owners.map((o) => o.user_id)).toEqual([a.userId])
    const ok = await parseDealInput(
      a.db,
      { title: 'Venta', pipeline_id: pa.id, stage_id: pa.pipeline_stages[0].id, contact_id: contactA, value: '10.555', assigned_to: owners[0].id, expected_close_date: '2026-12-01' },
      'create',
    )
    expect(ok).toEqual({
      ok: true,
      data: { title: 'Venta', value: 10.56, contact_id: contactA, assigned_to: owners[0].id, expected_close_date: '2026-12-01', pipeline_id: pa.id, stage_id: pa.pipeline_stages[0].id },
    })
    expect(await parseDealInput(a.db, { title: 'x', pipeline_id: pa.id, stage_id: pb.pipeline_stages[0].id }, 'create')).toEqual({ ok: false, error: 'invalid_stage' })
    expect(await parseDealInput(a.db, { title: 'x', pipeline_id: pb.id, stage_id: pb.pipeline_stages[0].id }, 'create')).toEqual({ ok: false, error: 'invalid_stage' })
    const foreignOwner = (await memberProfiles(b.db))[0]
    expect(await parseDealInput(a.db, { assigned_to: foreignOwner.id }, 'update')).toEqual({ ok: false, error: 'invalid_assigned_to' })
    // Moving stage within the current pipeline.
    expect(await parseDealInput(a.db, { stage_id: pa.pipeline_stages[1].id }, 'update', { pipeline_id: pa.id, stage_id: pa.pipeline_stages[0].id })).toEqual({
      ok: true,
      data: { pipeline_id: pa.id, stage_id: pa.pipeline_stages[1].id },
    })

    if (!ok.ok) throw new Error('unreachable')
    const deal = await a.db.deals.create({ data: { ...ok.data, title: 'Venta', pipeline_id: pa.id, stage_id: pa.pipeline_stages[0].id, workspace_id: a.workspaceId } })
    const deals = await contactDeals(a.db, contactA, { status: 'open', limit: 10 })
    expect(deals).toHaveLength(1)
    expect(deals[0]).toMatchObject({ id: deal.id, value: 10.56, expected_close_date: '2026-12-01', stage: { id: pa.pipeline_stages[0].id }, pipeline: { name: pa.name } })
    expect(await contactDeals(b.db, contactA, { limit: 10 })).toEqual([])
  })

  it('lists tasks with joins: open by due date (no date last), done by completion', async () => {
    const mk = (title: string, extra: Record<string, unknown> = {}) =>
      a.db.tasks.create({ data: { workspace_id: a.workspaceId, title, contact_id: contactA, ...extra }, include: TASK_INCLUDE }).then(taskRow)
    const later = await mk('later', { due_at: '2030-01-02T00:00:00Z', assignee_user_id: a.userId })
    const none = await mk('none')
    const soon = await mk('soon', { due_at: '2030-01-01T00:00:00Z' })
    await mk('done', { status: 'done', completed_at: '2030-01-01T00:00:00Z' })
    expect(soon.contact).toEqual({ id: contactA, name: 'Ana', phone: '+51911' })
    expect((await listTasks(a.db, { status: 'open', limit: 10 })).map((t) => t.title)).toEqual(['soon', 'later', 'none'])
    expect((await listTasks(a.db, { status: 'open', assignee: a.userId, limit: 10 })).map((t) => t.id)).toEqual([later.id])
    expect((await listTasks(a.db, { status: 'done', contactId: contactA, limit: 10 })).map((t) => t.title)).toEqual(['done'])
    expect(await listTasks(b.db, { status: 'open', limit: 10 })).toEqual([])
    expect(none.deal).toBeNull()
  })
})

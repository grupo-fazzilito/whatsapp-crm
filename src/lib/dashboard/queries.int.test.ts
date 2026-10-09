// Dashboard aggregations against a real PostgreSQL:
//   TEST_DATABASE_URL=postgresql://crm:crm@127.0.0.1:5434/crm npx vitest run src/lib/dashboard
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { pgTest } from '@/lib/test-utils/pg'
import { zonedDaysAgoStart, zonedLastNDayKeys } from './zoned'

vi.mock('server-only', () => ({}))

const pg = await pgTest()

describe.skipIf(!pg)('dashboard queries on PostgreSQL', async () => {
  if (!pg) return
  const { prisma, workspace, cleanup } = pg
  const q = await import('./queries')
  const tz = 'America/Bogota'
  const now = new Date()
  const today = zonedDaysAgoStart(0, tz, now)
  const yesterday = zonedDaysAgoStart(1, tz, now)
  const at = (base: Date, minutes: number) => new Date(base.getTime() + minutes * 60_000)
  let a: Awaited<ReturnType<typeof workspace>>
  let b: Awaited<ReturnType<typeof workspace>>
  let stageIds: string[] = []

  beforeAll(async () => {
    a = await workspace({ name: 'Dash A' })
    b = await workspace({ name: 'Dash B' })
    for (const w of [a, b]) {
      const ws = w.workspaceId
      const contact = await w.db.contacts.create({ data: { workspace_id: ws, name: 'Ana', phone: '+570001', created_at: at(today, 1) } })
      await w.db.contacts.create({ data: { workspace_id: ws, name: 'Old', phone: '+570002', created_at: at(yesterday, 1) } })
      const conv = await w.db.conversations.create({ data: { workspace_id: ws, contact_id: contact.id, status: 'open', created_at: at(today, 2) } })
      await w.db.messages.createMany({
        data: [
          // Yesterday: customer at +0, agent replies 10 min later.
          { workspace_id: ws, conversation_id: conv.id, sender_type: 'customer', content_text: 'hola', created_at: at(yesterday, 60) },
          { workspace_id: ws, conversation_id: conv.id, sender_type: 'agent', content_text: 'hi', created_at: at(yesterday, 70) },
          // Today: two customer messages, bot answers 30 min after the first.
          { workspace_id: ws, conversation_id: conv.id, sender_type: 'customer', content_text: 'q1', created_at: at(today, 3) },
          { workspace_id: ws, conversation_id: conv.id, sender_type: 'customer', content_text: 'q2', created_at: at(today, 4) },
          { workspace_id: ws, conversation_id: conv.id, sender_type: 'bot', content_text: 'a', created_at: at(today, 33) },
          { workspace_id: ws, conversation_id: conv.id, sender_type: 'agent', content_text: 'b', created_at: at(today, 34) },
          // Internal note: ignored everywhere.
          { workspace_id: ws, conversation_id: conv.id, sender_type: 'agent', content_text: 'note', is_internal: true, created_at: at(today, 35) },
        ],
      })
      const pipeline = await w.db.pipelines.create({ data: { workspace_id: ws, name: 'Sales' } })
      const s1 = await w.db.pipeline_stages.create({ data: { workspace_id: ws, pipeline_id: pipeline.id, name: 'New', color: '#111111', position: 0 } })
      const s2 = await w.db.pipeline_stages.create({ data: { workspace_id: ws, pipeline_id: pipeline.id, name: 'Won', color: '', position: 1 } })
      await w.db.pipeline_stages.create({ data: { workspace_id: ws, pipeline_id: pipeline.id, name: 'Empty', position: 2 } })
      await w.db.deals.createMany({
        data: [
          { workspace_id: ws, pipeline_id: pipeline.id, stage_id: s1.id, title: 'D1', value: 100.5, status: 'open', contact_id: contact.id },
          { workspace_id: ws, pipeline_id: pipeline.id, stage_id: s2.id, title: 'D2', value: 50, status: 'open' },
          { workspace_id: ws, pipeline_id: pipeline.id, stage_id: s2.id, title: 'D3', value: 999, status: 'won' },
        ],
      })
      if (w === a) stageIds = [s1.id, s2.id]
      await w.db.broadcasts.create({ data: { workspace_id: ws, name: 'Promo', template_name: 't', status: 'sent', total_recipients: 3 } })
      const auto = await w.db.automations.create({ data: { workspace_id: ws, name: 'Welcome', trigger_type: 'new_contact' } })
      await w.db.automation_logs.create({ data: { workspace_id: ws, automation_id: auto.id, contact_id: contact.id, trigger_event: 'new_contact', status: 'failed' } })
    }
  })
  afterAll(async () => {
    await cleanup(a, b)
    await prisma.$disconnect()
  })

  const scope = () => ({ db: a.db, workspaceId: a.workspaceId, tz, now })

  it('metric cards', async () => {
    const m = await q.loadMetrics(scope())
    expect(m.activeConversations.current).toBe(1)
    expect(m.activeConversations.previous).toBe(1) // 1 new today − 0 yesterday
    expect(m.newContactsToday).toEqual({ current: 1, previous: 1 })
    expect(m.openDealsValue).toBeCloseTo(150.5)
    expect(m.openDealsCount).toBe(2)
    expect(m.messagesSentToday).toEqual({ current: 1, previous: 1 })
  })

  it('conversations series groups by local day, outgoing = agent + bot', async () => {
    const series = await q.loadConversationsSeries(scope(), 7)
    const keys = zonedLastNDayKeys(7, tz, now)
    expect(series.map((p) => p.day)).toEqual(keys)
    expect(series[6]).toEqual({ day: keys[6], incoming: 2, outgoing: 2 })
    expect(series[5]).toEqual({ day: keys[5], incoming: 1, outgoing: 1 })
    expect(series.slice(0, 5).every((p) => p.incoming === 0 && p.outgoing === 0)).toBe(true)
  })

  it('pipeline donut keeps open deals per non-empty stage in position order', async () => {
    const donut = await q.loadPipelineDonut(scope())
    expect(donut.stages).toEqual([
      { id: stageIds[0], name: 'New', color: '#111111', dealCount: 1, totalValue: 100.5 },
      { id: stageIds[1], name: 'Won', color: '#64748b', dealCount: 1, totalValue: 50 },
    ])
    expect(donut.totalValue).toBeCloseTo(150.5)
  })

  it('response time pairs the first unanswered customer message with the next reply', async () => {
    const r = await q.loadResponseTime(scope())
    const samples = r.buckets.reduce((n, b) => n + b.samples, 0)
    expect(samples).toBe(2)
    const avgs = r.buckets.filter((b) => b.samples).map((b) => b.avgMinutes).sort((x, y) => (x ?? 0) - (y ?? 0))
    expect(avgs).toEqual([10, 30]) // yesterday 10 min, today 30 min
    expect(r.thisWeekAvg).not.toBeNull()
  })

  it('activity feed merges sources newest first', async () => {
    const items = await q.loadActivity(scope(), 50)
    const kinds = new Set(items.map((i) => i.kind))
    expect(kinds).toEqual(new Set(['message', 'contact', 'deal', 'broadcast', 'automation']))
    expect(items.find((i) => i.kind === 'message')?.text).toBe('New message from Ana')
    expect(items.find((i) => i.kind === 'automation')?.text).toBe('Automation "Welcome" failed for Ana')
    expect(items.find((i) => i.kind === 'broadcast')?.text).toBe('Broadcast "Promo" sent to 3 contacts')
    expect(items.some((i) => i.text === 'Deal "D1" in New')).toBe(true)
    const ats = items.map((i) => i.at)
    expect([...ats].sort().reverse()).toEqual(ats)
    expect(await q.loadActivity(scope(), 3)).toHaveLength(3)
  })

  it('never sees another workspace', async () => {
    const m = await q.loadMetrics(scope())
    expect(m.openDealsCount).toBe(2) // b has its own 2 open deals
    const series = await q.loadConversationsSeries(scope(), 7)
    expect(series.reduce((n, p) => n + p.incoming, 0)).toBe(3)
  })

  it('tenant transactions create pipelines with stages in the workspace', async () => {
    const p = await a.db.$transaction(async (tx) => {
      const row = await tx.pipelines.create({ data: { workspace_id: a.workspaceId, name: 'Tx' } })
      await tx.pipeline_stages.createMany({ data: [{ workspace_id: a.workspaceId, pipeline_id: row.id, name: 'S', position: 0 }] })
      return row
    })
    expect(await a.db.pipeline_stages.count({ where: { pipeline_id: p.id } })).toBe(1)
    expect(await b.db.pipelines.count({ where: { id: p.id } })).toBe(0)
  })
})

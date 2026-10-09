import 'server-only'
import type { TenantDb } from '@/lib/db/tenant'
import {
  zonedDaysAgoStart,
  zonedLastNDayKeys,
  zonedMondayIndex,
} from './zoned'
import type {
  ActivityItem,
  ConversationsSeriesPoint,
  MetricsBundle,
  PipelineDonutData,
  PipelineStageSlice,
  ResponseTimeBucket,
  ResponseTimeSummary,
} from './types'

// ------------------------------------------------------------
// Dashboard aggregations, served by GET /api/dashboard. Every query goes
// through the workspace-scoped client (raw SQL passes the workspace id
// itself). Day boundaries are computed in the viewer's time zone `tz`
// (sent by the browser), so "today" means what it did when this ran
// client-side.
// ------------------------------------------------------------

export interface DashboardScope {
  db: TenantDb
  workspaceId: string
  /** IANA time zone of the viewer (already validated). */
  tz: string
  now?: Date
}

// --- 1. Metric cards ---------------------------------------------------

export async function loadMetrics({ db, tz, now = new Date() }: DashboardScope): Promise<MetricsBundle> {
  const todayStart = zonedDaysAgoStart(0, tz, now)
  const yesterdayStart = zonedDaysAgoStart(1, tz, now)
  const agentSent = { sender_type: 'agent', is_internal: false }

  const [
    openConvCur,
    newConvToday,
    newConvYesterday,
    newContactsToday,
    newContactsYesterday,
    openDeals,
    messagesToday,
    messagesYesterday,
  ] = await Promise.all([
    db.conversations.count({ where: { status: 'open' } }),
    db.conversations.count({ where: { status: 'open', created_at: { gte: todayStart } } }),
    db.conversations.count({ where: { status: 'open', created_at: { gte: yesterdayStart, lt: todayStart } } }),
    db.contacts.count({ where: { created_at: { gte: todayStart } } }),
    db.contacts.count({ where: { created_at: { gte: yesterdayStart, lt: todayStart } } }),
    db.deals.findMany({ select: { value: true }, where: { status: 'open' } }),
    db.messages.count({ where: { ...agentSent, created_at: { gte: todayStart } } }),
    db.messages.count({ where: { ...agentSent, created_at: { gte: yesterdayStart, lt: todayStart } } }),
  ])

  const openDealsValue = openDeals.reduce((sum, d) => sum + (Number(d.value) || 0), 0)

  return {
    activeConversations: {
      current: openConvCur,
      // "vs yesterday" on a current-state count has no clean answer
      // without snapshots — we show the delta in NEW open conversations
      // today vs yesterday. That's the business-meaningful daily signal.
      previous: newConvToday - newConvYesterday,
    },
    newContactsToday: { current: newContactsToday, previous: newContactsYesterday },
    openDealsValue,
    openDealsCount: openDeals.length,
    messagesSentToday: { current: messagesToday, previous: messagesYesterday },
  }
}

// --- 2. Conversations over time ---------------------------------------

export async function loadConversationsSeries(
  { db, workspaceId, tz, now = new Date() }: DashboardScope,
  rangeDays: number,
): Promise<ConversationsSeriesPoint[]> {
  const start = zonedDaysAgoStart(rangeDays - 1, tz, now)
  // Grouped in SQL: a 90-day range can hold many messages.
  // Internal team notes are not conversation traffic.
  const rows = await db.$queryRaw<{ day: string; incoming: boolean; n: number }[]>`
    SELECT to_char(created_at AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS day,
           (sender_type = 'customer') AS incoming,
           count(*)::int AS n
      FROM public.messages
     WHERE workspace_id = ${workspaceId}::uuid
       AND is_internal = false
       AND created_at >= ${start}
     GROUP BY 1, 2`

  const keys = zonedLastNDayKeys(rangeDays, tz, now)
  const buckets = new Map<string, { incoming: number; outgoing: number }>()
  for (const k of keys) buckets.set(k, { incoming: 0, outgoing: 0 })
  for (const row of rows) {
    const bucket = buckets.get(row.day)
    if (!bucket) continue
    if (row.incoming) bucket.incoming += Number(row.n)
    else bucket.outgoing += Number(row.n) // agent + bot both count as outgoing
  }
  return keys.map((day) => ({ day, ...(buckets.get(day) ?? { incoming: 0, outgoing: 0 }) }))
}

// --- 3. Pipeline donut -------------------------------------------------

export async function loadPipelineDonut({ db }: DashboardScope): Promise<PipelineDonutData> {
  const [stages, deals] = await Promise.all([
    db.pipeline_stages.findMany({ select: { id: true, name: true, color: true }, orderBy: { position: 'asc' } }),
    db.deals.findMany({ select: { stage_id: true, value: true }, where: { status: 'open' } }),
  ])

  const byStage = new Map<string, { count: number; total: number }>()
  for (const d of deals) {
    const row = byStage.get(d.stage_id) ?? { count: 0, total: 0 }
    row.count += 1
    row.total += Number(d.value) || 0
    byStage.set(d.stage_id, row)
  }

  const slices: PipelineStageSlice[] = stages
    .map((s) => ({
      id: s.id,
      name: s.name,
      color: s.color || '#64748b',
      dealCount: byStage.get(s.id)?.count ?? 0,
      totalValue: byStage.get(s.id)?.total ?? 0,
    }))
    // Hide empty stages from the ring — keeps the visual clean.
    .filter((s) => s.totalValue > 0 || s.dealCount > 0)

  return {
    stages: slices,
    totalValue: slices.reduce((sum, s) => sum + s.totalValue, 0),
  }
}

// --- 4. Response time by day of week ----------------------------------

export async function loadResponseTime({ db, tz, now = new Date() }: DashboardScope): Promise<ResponseTimeSummary> {
  // The last 14 days of messages, walked per conversation to find each
  // "first inbound" → "first subsequent outbound" pair. 14 days gives
  // both "this week" and "last week".
  const rows = await db.messages.findMany({
    select: { conversation_id: true, sender_type: true, created_at: true },
    // Internal team notes are not conversation traffic.
    where: { is_internal: false, created_at: { gte: zonedDaysAgoStart(13, tz, now) } },
    orderBy: [{ conversation_id: 'asc' }, { created_at: 'asc' }],
  })

  // A single customer message counts once (double-messaging while the
  // agent takes time to reply does not inflate the average).
  const samples: { customerAt: Date; responseAt: Date }[] = []
  let currentConv = ''
  let pendingCustomer: Date | null = null
  for (const row of rows) {
    if (row.conversation_id !== currentConv) {
      currentConv = row.conversation_id
      pendingCustomer = null
    }
    if (!row.created_at) continue
    const ts = new Date(row.created_at as unknown as string)
    if (row.sender_type === 'customer') {
      if (!pendingCustomer) pendingCustomer = ts
    } else if (pendingCustomer) {
      samples.push({ customerAt: pendingCustomer, responseAt: ts })
      pendingCustomer = null
    }
  }

  const thisWeekStart = zonedDaysAgoStart(zonedMondayIndex(now, tz), tz, now)
  const lastWeekStart = zonedDaysAgoStart(zonedMondayIndex(now, tz) + 7, tz, now)

  // Per-day-of-week buckets over both weeks; a day without samples
  // keeps avgMinutes null and the chart renders the bar muted.
  const byDow = new Map<number, number[]>()
  for (let i = 0; i < 7; i++) byDow.set(i, [])
  const thisWeekMins: number[] = []
  const lastWeekMins: number[] = []

  for (const s of samples) {
    const diffMin = (s.responseAt.getTime() - s.customerAt.getTime()) / 60_000
    if (diffMin < 0) continue
    byDow.get(zonedMondayIndex(s.customerAt, tz))!.push(diffMin)
    if (s.customerAt >= thisWeekStart) thisWeekMins.push(diffMin)
    else if (s.customerAt >= lastWeekStart) lastWeekMins.push(diffMin)
  }

  const avg = (arr: number[]) => (arr.length === 0 ? null : arr.reduce((a, b) => a + b, 0) / arr.length)

  const buckets: ResponseTimeBucket[] = Array.from({ length: 7 }, (_, dow) => {
    const list = byDow.get(dow) ?? []
    return { dow, avgMinutes: avg(list), samples: list.length }
  })

  return { buckets, thisWeekAvg: avg(thisWeekMins), lastWeekAvg: avg(lastWeekMins) }
}

// --- 5. Activity feed --------------------------------------------------

export async function loadActivity({ db }: DashboardScope, limit = 20): Promise<ActivityItem[]> {
  // ~10 from each source, interleaved by timestamp; the final limit is
  // enforced after the sort.
  const [msgs, contacts, deals, broadcasts, autoLogs] = await Promise.all([
    db.messages.findMany({
      select: {
        id: true,
        created_at: true,
        conversation_id: true,
        conversations: { select: { contacts: { select: { name: true, phone: true } } } },
      },
      where: { sender_type: 'customer' },
      orderBy: { created_at: 'desc' },
      take: 10,
    }),
    db.contacts.findMany({
      select: { id: true, name: true, phone: true, created_at: true },
      orderBy: { created_at: 'desc' },
      take: 10,
    }),
    db.deals.findMany({
      select: { id: true, title: true, updated_at: true, pipeline_stages: { select: { name: true } } },
      orderBy: { updated_at: 'desc' },
      take: 10,
    }),
    db.broadcasts.findMany({
      select: { id: true, name: true, status: true, total_recipients: true, created_at: true },
      orderBy: { created_at: 'desc' },
      take: 5,
    }),
    db.automation_logs.findMany({
      select: {
        id: true,
        status: true,
        created_at: true,
        automations: { select: { name: true } },
        contacts: { select: { name: true, phone: true } },
      },
      orderBy: { created_at: 'desc' },
      take: 10,
    }),
  ])

  const iso = (v: unknown) => (v == null ? '' : String(v))
  const items: ActivityItem[] = []

  for (const m of msgs) {
    const contact = m.conversations?.contacts
    const who = contact?.name || contact?.phone || 'Unknown'
    items.push({
      id: `msg-${m.id}`,
      kind: 'message',
      text: `New message from ${who}`,
      at: iso(m.created_at),
      href: `/inbox?c=${m.conversation_id}`,
    })
  }

  for (const c of contacts) {
    items.push({
      id: `contact-${c.id}`,
      kind: 'contact',
      text: `New contact: ${c.name || c.phone}`,
      at: iso(c.created_at),
      href: '/contacts',
    })
  }

  for (const d of deals) {
    const stage = d.pipeline_stages
    items.push({
      id: `deal-${d.id}`,
      kind: 'deal',
      text: stage?.name ? `Deal "${d.title}" in ${stage.name}` : `Deal "${d.title}" updated`,
      at: iso(d.updated_at),
      href: '/pipelines',
    })
  }

  for (const b of broadcasts) {
    const label =
      b.status === 'sent'
        ? `sent to ${b.total_recipients} contacts`
        : `${b.status} (${b.total_recipients} recipients)`
    items.push({
      id: `broadcast-${b.id}`,
      kind: 'broadcast',
      text: `Broadcast "${b.name}" ${label}`,
      at: iso(b.created_at),
      href: '/broadcasts',
    })
  }

  for (const l of autoLogs) {
    const who = l.contacts?.name || l.contacts?.phone || 'a contact'
    const autoName = l.automations?.name || 'Automation'
    items.push({
      id: `auto-${l.id}`,
      kind: 'automation',
      text: `Automation "${autoName}" ${l.status === 'failed' ? 'failed for' : 'triggered for'} ${who}`,
      at: iso(l.created_at),
    })
  }

  return items.sort((a, b) => (a.at > b.at ? -1 : a.at < b.at ? 1 : 0)).slice(0, limit)
}


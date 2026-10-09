import 'server-only'
import { prisma } from '@/lib/db/prisma'
import { normalizeRaw } from '@/lib/db/compat'
import { zonedDayKey, zonedDaysAgoStart } from './zoned'
import { loadMetrics, loadResponseTime, type DashboardScope } from './queries'
import type { WidgetId } from './widgets'

// Numbers for the dashboard KPI widgets. Every query is filtered by the
// workspace id (raw SQL here, so the filter is explicit). "Today" is the
// viewer's day in `tz`.

export interface KpiScope extends DashboardScope {
  userId: string
  /** Business time zone, for booking dates (stored as local dates). */
  businessTz: string
  currency: string
}

type Row = Record<string, unknown>
const num = (v: unknown) => Number(v ?? 0)

async function q<T extends Row>(sql: TemplateStringsArray, ...values: unknown[]): Promise<T[]> {
  return normalizeRaw(await prisma.$queryRaw<T[]>(sql, ...values))
}

export async function loadKpis(ids: WidgetId[], scope: KpiScope): Promise<Partial<Record<WidgetId, unknown>>> {
  const ws = scope.workspaceId
  const today = zonedDaysAgoStart(0, scope.tz)
  const yesterday = zonedDaysAgoStart(1, scope.tz)
  const out: Partial<Record<WidgetId, unknown>> = {}
  const want = new Set(ids)
  const jobs: Promise<void>[] = []

  const metrics = want.has('active_conversations') || want.has('new_leads') || want.has('open_deals') || want.has('messages_today') ? loadMetrics(scope) : null

  if (want.has('conversations_handled')) {
    jobs.push(
      (async () => {
        const [r] = await q`
          SELECT
            count(DISTINCT m.conversation_id) FILTER (WHERE m.created_at >= ${today}) AS total,
            count(DISTINCT m.conversation_id) FILTER (WHERE m.created_at >= ${today} AND m.sender_type = 'bot') AS ai,
            count(DISTINCT m.conversation_id) FILTER (WHERE m.created_at >= ${today} AND m.sender_type = 'agent') AS human,
            count(DISTINCT m.conversation_id) FILTER (WHERE m.created_at < ${today}) AS yesterday
          FROM messages m
          WHERE m.workspace_id = ${ws}::uuid AND m.created_at >= ${yesterday}
            AND m.sender_type IN ('agent', 'bot') AND m.content_type <> 'system' AND COALESCE(m.is_internal, false) = false`
        out.conversations_handled = { total: num(r?.total), ai: num(r?.ai), human: num(r?.human), yesterday: num(r?.yesterday) }
      })(),
    )
  }

  if (want.has('unanswered')) {
    jobs.push(
      (async () => {
        const [r] = await q`
          SELECT count(*) AS n, min(last.created_at) AS oldest
          FROM conversations c
          CROSS JOIN LATERAL (
            SELECT m.sender_type, m.created_at FROM messages m
            WHERE m.conversation_id = c.id AND m.content_type <> 'system' AND COALESCE(m.is_internal, false) = false
            ORDER BY m.created_at DESC LIMIT 1
          ) last
          WHERE c.workspace_id = ${ws}::uuid AND c.status <> 'closed' AND last.sender_type = 'customer'`
        out.unanswered = { count: num(r?.n), oldestSince: (r?.oldest as string | null) ?? null }
      })(),
    )
  }

  if (want.has('messages_today')) {
    jobs.push(
      (async () => {
        const [r] = await q`
          SELECT count(*) FILTER (WHERE sender_type = 'customer') AS inbound,
                 count(*) FILTER (WHERE sender_type IN ('agent', 'bot')) AS outbound
          FROM messages
          WHERE workspace_id = ${ws}::uuid AND created_at >= ${today} AND content_type <> 'system' AND COALESCE(is_internal, false) = false`
        out.messages_today = { inbound: num(r?.inbound), outbound: num(r?.outbound) }
      })(),
    )
  }

  if (want.has('first_response')) {
    jobs.push(
      (async () => {
        const rt = await loadResponseTime(scope)
        out.first_response = { thisWeekAvg: rt.thisWeekAvg, lastWeekAvg: rt.lastWeekAvg }
      })(),
    )
  }

  if (want.has('ai_today')) {
    jobs.push(
      (async () => {
        const [m] = await q`
          SELECT count(*) AS replies, count(DISTINCT conversation_id) AS conversations
          FROM messages WHERE workspace_id = ${ws}::uuid AND created_at >= ${today} AND sender_type = 'bot' AND content_type <> 'system'`
        const [h] = await q`
          SELECT count(*) AS n FROM ai_chat_logs
          WHERE workspace_id = ${ws}::uuid AND created_at >= ${today} AND detected_intent IN ('handover', 'emergency')`
        const [t] = await q`
          SELECT COALESCE(-sum(credits), 0) AS used FROM credit_ledger
          WHERE workspace_id = ${ws}::uuid AND created_at >= ${today} AND kind = 'usage'`
        out.ai_today = { replies: num(m?.replies), conversations: num(m?.conversations), handovers: num(h?.n), tokens: num(t?.used) }
      })(),
    )
  }

  if (want.has('tasks_due')) {
    jobs.push(
      (async () => {
        const endOfToday = new Date(today.getTime() + 86_400_000)
        const [r] = await q`
          SELECT count(*) FILTER (WHERE due_at < ${today}) AS overdue,
                 count(*) FILTER (WHERE due_at >= ${today} AND due_at < ${endOfToday}) AS today,
                 count(*) AS open
          FROM tasks
          WHERE workspace_id = ${ws}::uuid AND status = 'open' AND assignee_user_id = ${scope.userId}::uuid`
        out.tasks_due = { overdue: num(r?.overdue), today: num(r?.today), open: num(r?.open) }
      })(),
    )
  }

  if (want.has('bookings_today')) {
    jobs.push(
      (async () => {
        const day = zonedDayKey(new Date(), scope.businessTz)
        const [c] = await q`
          SELECT count(*) AS n FROM bookings
          WHERE workspace_id = ${ws}::uuid AND booking_date = ${day}::date AND status IN ('pending', 'confirmed')`
        const next = await q`
          SELECT b.id, to_char(b.booking_date, 'YYYY-MM-DD') AS date, b.booking_time AS time, b.customer_name,
                 s.name AS service, p.name AS product
          FROM bookings b
          LEFT JOIN services s ON s.id = b.service_id
          LEFT JOIN products p ON p.id = b.product_id
          WHERE b.workspace_id = ${ws}::uuid AND b.status IN ('pending', 'confirmed')
            AND (b.booking_date > ${day}::date OR (b.booking_date = ${day}::date AND b.booking_time >= to_char(now() AT TIME ZONE ${scope.businessTz}, 'HH24:MI')))
          ORDER BY b.booking_date, b.booking_time
          LIMIT 4`
        out.bookings_today = { today: num(c?.n), upcoming: next }
      })(),
    )
  }

  if (want.has('orders_today')) {
    jobs.push(
      (async () => {
        const [r] = await q`
          SELECT count(*) FILTER (WHERE created_at >= ${today}) AS today,
                 COALESCE(sum(total) FILTER (WHERE created_at >= ${today} AND status <> 'cancelled'), 0) AS revenue,
                 count(*) FILTER (WHERE status = 'pending') AS pending
          FROM orders WHERE workspace_id = ${ws}::uuid`
        out.orders_today = { today: num(r?.today), revenue: num(r?.revenue), pending: num(r?.pending), currency: scope.currency }
      })(),
    )
  }

  if (want.has('hot_leads')) {
    jobs.push(
      (async () => {
        const weekAgo = zonedDaysAgoStart(7, scope.tz)
        const [r] = await q`
          SELECT count(*) FILTER (WHERE temperature = 'hot') AS hot,
                 count(*) FILTER (WHERE temperature = 'warm') AS warm,
                 count(*) FILTER (WHERE qualified_at >= ${weekAgo}) AS qualified_week
          FROM lead_profiles WHERE workspace_id = ${ws}::uuid`
        out.hot_leads = { hot: num(r?.hot), warm: num(r?.warm), qualifiedWeek: num(r?.qualified_week) }
      })(),
    )
  }

  if (want.has('channel_breakdown')) {
    jobs.push(
      (async () => {
        const rows = await q`
          SELECT ch.type, count(*) FILTER (WHERE m.sender_type = 'customer') AS inbound,
                 count(DISTINCT m.conversation_id) AS conversations
          FROM messages m
          JOIN conversations c ON c.id = m.conversation_id
          JOIN channels ch ON ch.id = c.channel_id
          WHERE m.workspace_id = ${ws}::uuid AND m.created_at >= ${today} AND m.content_type <> 'system'
          GROUP BY ch.type ORDER BY conversations DESC`
        out.channel_breakdown = rows.map((r) => ({ type: String(r.type), inbound: num(r.inbound), conversations: num(r.conversations) }))
      })(),
    )
  }

  await Promise.all(jobs)
  if (metrics) {
    const m = await metrics
    if (want.has('active_conversations')) out.active_conversations = m.activeConversations
    if (want.has('new_leads')) out.new_leads = m.newContactsToday
    if (want.has('open_deals')) out.open_deals = { value: m.openDealsValue, count: m.openDealsCount, currency: scope.currency }
    if (want.has('messages_today') && out.messages_today) (out.messages_today as Row).sentYesterday = m.messagesSentToday.previous
  }
  return out
}

/** Getting-started checklist shown until the first channel is connected. */
export async function loadSetup(workspaceId: string) {
  const [r] = await q`
    SELECT
      (SELECT count(*) FROM channels WHERE workspace_id = ${workspaceId}::uuid AND status = 'connected') AS channels,
      (SELECT count(*) FROM ai_agents WHERE workspace_id = ${workspaceId}::uuid AND enabled) AS agents,
      (SELECT count(*) FROM ai_agents WHERE workspace_id = ${workspaceId}::uuid AND COALESCE(btrim(training_context), '') <> '') AS trained,
      (SELECT count(*) FROM credit_ledger WHERE workspace_id = ${workspaceId}::uuid AND action = 'playground') AS tested,
      (SELECT count(*) FROM channels WHERE workspace_id = ${workspaceId}::uuid AND ai_agent_id IS NOT NULL) AS assigned,
      (SELECT count(*) FROM business_hours WHERE workspace_id = ${workspaceId}::uuid) AS hours,
      (SELECT (COALESCE(btrim(phone), '') <> '' OR COALESCE(btrim(address), '') <> '' OR COALESCE(btrim(description), '') <> '') FROM workspaces WHERE id = ${workspaceId}::uuid) AS profile,
      (SELECT id::text FROM ai_agents WHERE workspace_id = ${workspaceId}::uuid ORDER BY (COALESCE(btrim(training_context), '') <> ''), created_at LIMIT 1) AS first_agent`
  return {
    account: true,
    business: !!r?.profile || num(r?.hours) > 0,
    agent: num(r?.agents) > 0,
    training: num(r?.trained) > 0,
    test: num(r?.tested) > 0,
    channel: num(r?.channels) > 0,
    assign: num(r?.assigned) > 0,
    firstAgentId: (r?.first_agent as string | null) ?? null,
  }
}

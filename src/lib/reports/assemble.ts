// Turns the raw documents of the reports_* RPCs (migration 034) plus the
// resolution closures into the ReportPayload the UI renders. Pure.

import type { ReportRange } from './range'
import type { ReportSettings } from './settings'
import {
  buildSessions,
  humanResponseByAgent,
  parseStream,
  summarizeResolutions,
  summarizeResponses,
  type Closure,
  type StreamRow,
} from './sessions'
import { ratio } from './stats'
import type { AgentRow, AiAgentRow, ChannelRef, NamedRef, ReportPayload, ReportScope, ResolutionBasis, StatusRow } from './types'

/** Messages before `from` loaded to know whether a session was already open. */
export const STREAM_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000
/** Replies after `to` still count for sessions that started in range. */
export const STREAM_LOOKAHEAD_MS = 24 * 60 * 60 * 1000

const n = (v: unknown) => (typeof v === 'number' ? v : Number(v ?? 0) || 0)

export interface VolumeDoc {
  by_day: { day: string; inbound: number; agent: number; bot: number }[]
  by_channel: { channel_id: string | null; inbound: number; agent: number; bot: number; conversations: number }[]
  heatmap: { dow: number; hour: number; inbound: number }[]
  by_agent: { user_id: string; messages: number; conversations: number }[]
  by_ai_agent: { ai_agent_id: string | null; messages: number; conversations: number }[]
  mix: { ai_only: number; human_only: number; both: number; no_reply: number }
  conversations_started: number
}
export interface StreamDoc {
  rows: StreamRow[]
  truncated: boolean
}
export interface SnapshotDoc {
  unanswered: number
  oldest_waiting: string | null
  waiting: { conversation_id: string; since: string; channel_id: string | null; assigned_agent_id: string | null; contact: string | null }[]
  open_load: { user_id: string; open: number; pending: number }[]
}
export interface BusinessDoc {
  orders_by_status: { status: string; count: number; total: number }[]
  bookings_by_status: { status: string; count: number }[]
  conversion: { active_conversations: number; with_order: number }
  ai_cost: { ai_agent_id: string | null; calls: number; cost_usd: number }[]
  handovers: { ai_agent_id: string | null; count: number; conversations: number }[]
  handover_conversations: number
}

export interface AssembleInput {
  scope: ReportScope
  userId: string
  range: ReportRange
  settings: ReportSettings
  workspace: { currency: string; locale: string; country: string | null }
  filters: { channelId: string | null; agentId: string | null; teamId: string | null }
  options: { channels: ChannelRef[]; agents: NamedRef[]; teams: NamedRef[] | null; aiAgents: NamedRef[] }
  modules: { orders: boolean; bookings: boolean }
  volume: VolumeDoc
  stream: StreamDoc
  snapshot: SnapshotDoc
  business: BusinessDoc | null
  closures: Closure[]
  basis: ResolutionBasis
  now: Date
}

function statusRows(rows: { status: string; count: number; total?: number }[], order: readonly string[]): StatusRow[] {
  const out = rows.map((r) => ({ status: r.status, count: n(r.count), ...(r.total !== undefined ? { total: n(r.total) } : {}) }))
  return out.sort((a, b) => {
    const ia = order.indexOf(a.status)
    const ib = order.indexOf(b.status)
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
  })
}

const ORDER_STATUS_ORDER = ['pending', 'confirmed', 'preparing', 'ready', 'shipped', 'delivered', 'cancelled'] as const
const BOOKING_STATUS_ORDER = ['pending', 'confirmed', 'completed', 'cancelled', 'no_show'] as const

export function assembleReport(i: AssembleInput): ReportPayload {
  const { range, settings } = i
  const w = { from: range.from.getTime(), to: range.to.getTime() }
  const now = i.now.getTime()

  // ---- Attention (sessions) ----
  const resolves = new Map<string, number[]>()
  for (const c of i.closures) {
    const l = resolves.get(c.conversationId) ?? []
    l.push(c.at)
    resolves.set(c.conversationId, l)
  }
  const sessions = buildSessions(parseStream(i.stream.rows), resolves)
  const resp = summarizeResponses(sessions, w, now, settings.slaMinutes)
  const resol = summarizeResolutions(sessions, i.closures, w)
  const humanByAgent = humanResponseByAgent(sessions, w)

  const channelById = new Map(i.options.channels.map((c) => [c.id, c]))
  const agentName = new Map(i.options.agents.map((a) => [a.id, a.name]))
  const aiName = new Map(i.options.aiAgents.map((a) => [a.id, a.name]))

  // ---- Volume ----
  const dayMap = new Map(i.volume.by_day.map((d) => [d.day, d]))
  const byDay = range.days.map((day) => {
    const d = dayMap.get(day)
    return { day, inbound: n(d?.inbound), agent: n(d?.agent), bot: n(d?.bot) }
  })
  const totals = byDay.reduce((t, d) => ({ inbound: t.inbound + d.inbound, agent: t.agent + d.agent, bot: t.bot + d.bot }), { inbound: 0, agent: 0, bot: 0 })
  const byChannel = i.volume.by_channel
    .map((c) => {
      const ref = c.channel_id ? channelById.get(c.channel_id) : undefined
      return {
        channelId: c.channel_id,
        name: ref?.name ?? '',
        type: ref?.type ?? null,
        purpose: ref?.purpose ?? null,
        inbound: n(c.inbound),
        agent: n(c.agent),
        bot: n(c.bot),
        conversations: n(c.conversations),
      }
    })
    .sort((a, b) => b.inbound + b.agent + b.bot - (a.inbound + a.agent + a.bot))
  const purposeMap = new Map<string, { purpose: string; inbound: number; outbound: number }>()
  for (const c of byChannel) {
    const key = c.purpose || 'none'
    const p = purposeMap.get(key) ?? { purpose: key, inbound: 0, outbound: 0 }
    p.inbound += c.inbound
    p.outbound += c.agent + c.bot
    purposeMap.set(key, p)
  }
  const heatmap = Array.from({ length: 7 }, () => Array<number>(24).fill(0))
  for (const h of i.volume.heatmap) {
    if (h.dow >= 0 && h.dow < 7 && h.hour >= 0 && h.hour < 24) heatmap[h.dow][h.hour] += n(h.inbound)
  }

  // ---- Team ----
  const agentRows = new Map<string, AgentRow>()
  const row = (id: string) => {
    let r = agentRows.get(id)
    if (!r) {
      r = { userId: id, name: agentName.get(id) ?? '', conversations: 0, messages: 0, firstResponses: 0, medianFirstResponseMs: null, resolved: 0, open: 0, pending: 0 }
      agentRows.set(id, r)
    }
    return r
  }
  for (const a of i.volume.by_agent) Object.assign(row(a.user_id), { messages: n(a.messages), conversations: n(a.conversations) })
  for (const [id, v] of humanByAgent) Object.assign(row(id), { firstResponses: v.sessions, medianFirstResponseMs: v.medianMs })
  for (const [id, count] of resol.byUser) row(id).resolved = count
  for (const l of i.snapshot.open_load) Object.assign(row(l.user_id), { open: n(l.open), pending: n(l.pending) })
  let agents = [...agentRows.values()]
  if (i.scope === 'personal') agents = agents.filter((a) => a.userId === i.userId)
  else if (i.filters.agentId) agents = agents.filter((a) => a.userId === i.filters.agentId)
  agents.sort((a, b) => b.messages - a.messages || b.conversations - a.conversations || a.name.localeCompare(b.name))

  const mix = {
    agentReplies: totals.agent,
    botReplies: totals.bot,
    aiOnly: n(i.volume.mix?.ai_only),
    humanOnly: n(i.volume.mix?.human_only),
    both: n(i.volume.mix?.both),
    noReply: n(i.volume.mix?.no_reply),
    handedOver: n(i.business?.handover_conversations),
  }

  // ---- AI ----
  let ai: ReportPayload['ai'] = null
  if (i.business) {
    const rows = new Map<string, AiAgentRow>()
    const key = (id: string | null) => id ?? '∅'
    const airow = (id: string | null) => {
      let r = rows.get(key(id))
      if (!r) {
        r = { aiAgentId: id, name: id ? (aiName.get(id) ?? '') : '', replies: 0, conversations: 0, handovers: 0, handoverRate: null, calls: 0, costUsd: 0, costLocal: null }
        rows.set(key(id), r)
      }
      return r
    }
    for (const a of i.volume.by_ai_agent) Object.assign(airow(a.ai_agent_id), { replies: n(a.messages), conversations: n(a.conversations) })
    for (const h of i.business.handovers) airow(h.ai_agent_id).handovers = n(h.conversations)
    for (const c of i.business.ai_cost) Object.assign(airow(c.ai_agent_id), { calls: n(c.calls), costUsd: n(c.cost_usd) })
    const list = [...rows.values()].map((r) => ({
      ...r,
      handoverRate: ratio(r.handovers, r.conversations),
      costLocal: settings.usdRate !== null ? r.costUsd * settings.usdRate : null,
    }))
    list.sort((a, b) => b.replies - a.replies || b.costUsd - a.costUsd)
    const totalCostUsd = list.reduce((s, r) => s + r.costUsd, 0)
    ai = {
      agents: list,
      totalCostUsd,
      totalCostLocal: settings.usdRate !== null ? totalCostUsd * settings.usdRate : null,
      calls: list.reduce((s, r) => s + r.calls, 0),
    }
  }

  // ---- Sales ----
  let sales: ReportPayload['sales'] = null
  if (i.business && (i.modules.orders || i.modules.bookings)) {
    const ordersByStatus = statusRows(i.business.orders_by_status, ORDER_STATUS_ORDER)
    const active = n(i.business.conversion?.active_conversations)
    const withOrder = n(i.business.conversion?.with_order)
    sales = {
      modules: i.modules,
      ordersByStatus,
      ordersCount: ordersByStatus.reduce((s, r) => s + r.count, 0),
      revenue: ordersByStatus.filter((r) => r.status !== 'cancelled').reduce((s, r) => s + (r.total ?? 0), 0),
      bookingsByStatus: statusRows(i.business.bookings_by_status, BOOKING_STATUS_ORDER),
      conversion: { activeConversations: active, withOrder, rate: ratio(withOrder, active) },
    }
  }

  return {
    scope: i.scope,
    generatedAt: i.now.toISOString(),
    range: { preset: range.preset, fromDate: range.fromDate, toDate: range.toDate, timeZone: range.timeZone, days: range.days },
    settings: { slaMinutes: settings.slaMinutes, usdRate: settings.usdRate, currency: i.workspace.currency, locale: i.workspace.locale, country: i.workspace.country },
    filters: i.filters,
    options: { channels: i.options.channels, agents: i.options.agents, teams: i.options.teams },
    truncated: !!i.stream.truncated,
    attention: {
      conversationsStarted: n(i.volume.conversations_started),
      sessions: resp.sessions,
      answered: resp.answered,
      unansweredSessions: resp.unanswered,
      answeredByBot: resp.answeredByBot,
      answeredByAgent: resp.answeredByAgent,
      medianFirstResponseMs: resp.medianMs,
      p90FirstResponseMs: resp.p90Ms,
      humanAnswered: resp.humanAnswered,
      medianHumanResponseMs: resp.humanMedianMs,
      p90HumanResponseMs: resp.humanP90Ms,
      slaEligible: resp.slaEligible,
      withinSla: resp.withinSla,
      slaRate: resp.slaRate,
      resolution: { basis: i.basis, resolved: resol.resolved, measured: resol.measured, medianMs: resol.medianMs, p90Ms: resol.p90Ms },
      unansweredNow: {
        count: n(i.snapshot.unanswered),
        oldestSince: i.snapshot.oldest_waiting,
        waiting: i.snapshot.waiting.map((x) => ({
          conversationId: x.conversation_id,
          since: x.since,
          contact: x.contact,
          channelName: x.channel_id ? (channelById.get(x.channel_id)?.name ?? null) : null,
          assignee: x.assigned_agent_id ? (agentName.get(x.assigned_agent_id) ?? null) : null,
        })),
      },
    },
    volume: { totals, byDay, byChannel, byPurpose: [...purposeMap.values()], heatmap },
    team: { agents, mix },
    ai,
    sales,
  }
}

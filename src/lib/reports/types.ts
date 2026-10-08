// Shapes shared by /api/reports and the reports UI.

import type { Preset } from './range'

export type ReportScope = 'workspace' | 'personal'
/** Where resolution instants come from (see assemble.ts). */
export type ResolutionBasis = 'events' | 'resolved_at' | 'mixed' | 'closed_status' | 'none'

export interface NamedRef {
  id: string
  name: string
}
export interface ChannelRef extends NamedRef {
  type: string
  purpose: string | null
}

export interface DayPoint {
  day: string
  inbound: number
  agent: number
  bot: number
}

export interface ChannelVolume {
  channelId: string | null
  name: string
  type: string | null
  purpose: string | null
  inbound: number
  agent: number
  bot: number
  conversations: number
}

export interface PurposeVolume {
  purpose: string
  inbound: number
  outbound: number
}

export interface WaitingConversation {
  conversationId: string
  since: string
  contact: string | null
  channelName: string | null
  assignee: string | null
}

export interface AgentRow {
  userId: string
  name: string
  conversations: number
  messages: number
  firstResponses: number
  medianFirstResponseMs: number | null
  resolved: number
  open: number
  pending: number
}

export interface AiAgentRow {
  aiAgentId: string | null
  name: string
  replies: number
  conversations: number
  handovers: number
  handoverRate: number | null
  calls: number
  costUsd: number
  costLocal: number | null
}

export interface StatusRow {
  status: string
  count: number
  total?: number
}

export interface ReportPayload {
  scope: ReportScope
  generatedAt: string
  range: { preset: Preset; fromDate: string; toDate: string; timeZone: string; days: string[] }
  settings: { slaMinutes: number; usdRate: number | null; currency: string; locale: string; country: string | null }
  filters: { channelId: string | null; agentId: string | null; teamId: string | null }
  options: { channels: ChannelRef[]; agents: NamedRef[]; teams: NamedRef[] | null }
  /** True when the message stream hit its cap (metrics are partial). */
  truncated: boolean
  attention: {
    conversationsStarted: number
    sessions: number
    answered: number
    unansweredSessions: number
    answeredByBot: number
    answeredByAgent: number
    medianFirstResponseMs: number | null
    p90FirstResponseMs: number | null
    humanAnswered: number
    medianHumanResponseMs: number | null
    p90HumanResponseMs: number | null
    slaEligible: number
    withinSla: number
    slaRate: number | null
    resolution: { basis: ResolutionBasis; resolved: number; measured: number; medianMs: number | null; p90Ms: number | null }
    unansweredNow: { count: number; oldestSince: string | null; waiting: WaitingConversation[] }
  }
  volume: {
    totals: { inbound: number; agent: number; bot: number }
    byDay: DayPoint[]
    byChannel: ChannelVolume[]
    byPurpose: PurposeVolume[]
    /** heatmap[dow 0=Mon..6=Sun][hour 0..23] = inbound customer messages. */
    heatmap: number[][]
  }
  team: {
    agents: AgentRow[]
    mix: {
      agentReplies: number
      botReplies: number
      aiOnly: number
      humanOnly: number
      both: number
      noReply: number
      /** Conversations the AI explicitly handed to a person (logs). */
      handedOver: number
    }
  }
  /** Null in the personal view. */
  ai: {
    agents: AiAgentRow[]
    totalCostUsd: number
    totalCostLocal: number | null
    calls: number
  } | null
  /** Null in the personal view or when neither orders nor bookings are enabled. */
  sales: {
    modules: { orders: boolean; bookings: boolean }
    ordersByStatus: StatusRow[]
    ordersCount: number
    /** Sum of non-cancelled orders. */
    revenue: number
    bookingsByStatus: StatusRow[]
    conversion: { activeConversations: number; withOrder: number; rate: number | null }
  } | null
}

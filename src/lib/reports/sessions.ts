// Attention sessions, first response and SLA — pure, unit-tested.
//
// A conversation is split into "sessions" (one customer need each):
// - A session opens at a customer message when none is open.
// - It closes when the conversation is resolved (a resolve event at or
//   after its start), or — once it has been answered — after ≥24h of
//   silence (no message from anyone). An UNANSWERED session stays open
//   until someone replies or it is resolved, so a slow reply still counts
//   as a slow reply instead of disappearing.
// - First response = first agent or bot message after the session start.
//   First human response = first agent (person) message.
// Internal notes and system messages never reach these helpers.

import { median, percentile, ratio } from './stats'

export const SESSION_GAP_MS = 24 * 60 * 60 * 1000

export type SenderKind = 'customer' | 'agent' | 'bot'

export interface StreamMessage {
  conversationId: string
  kind: SenderKind
  /** User id for agents. */
  senderId: string | null
  /** AI agent id for bots. */
  aiAgentId: string | null
  /** Epoch ms. */
  at: number
}

export interface Session {
  conversationId: string
  start: number
  /** Last message inside the session. */
  end: number
  firstReplyAt: number | null
  firstReplyKind: 'agent' | 'bot' | null
  /** User id (agent) or AI agent id (bot) of the first reply. */
  firstReplyBy: string | null
  firstHumanAt: number | null
  firstHumanBy: string | null
  resolvedAt: number | null
}

/** Compact rows from the reports_stream RPC: [conv, c|a|b, sender_id, ai_agent_id, epoch_ms]. */
export type StreamRow = [string, 'c' | 'a' | 'b', string | null, string | null, number | string]

export function parseStream(rows: readonly StreamRow[]): StreamMessage[] {
  return rows.map(([conversationId, k, senderId, aiAgentId, at]) => ({
    conversationId,
    kind: k === 'c' ? 'customer' : k === 'a' ? 'agent' : 'bot',
    senderId,
    aiAgentId,
    at: Number(at),
  }))
}

/**
 * Builds sessions for every conversation in `messages` (any order).
 * `resolves` maps conversation id → resolve instants (epoch ms).
 */
export function buildSessions(
  messages: readonly StreamMessage[],
  resolves?: ReadonlyMap<string, readonly number[]>,
  gapMs: number = SESSION_GAP_MS,
): Session[] {
  const byConv = new Map<string, StreamMessage[]>()
  for (const m of messages) {
    const list = byConv.get(m.conversationId)
    if (list) list.push(m)
    else byConv.set(m.conversationId, [m])
  }

  const out: Session[] = []
  for (const [conversationId, list] of byConv) {
    list.sort((a, b) => a.at - b.at)
    const rs = [...(resolves?.get(conversationId) ?? [])].sort((a, b) => a - b)
    let ri = 0
    let cur: Session | null = null
    let lastAt: number | null = null

    const close = () => {
      if (cur) out.push(cur)
      cur = null
    }

    for (const m of list) {
      // Resolves up to this message close the open session.
      while (ri < rs.length && rs[ri] <= m.at) {
        const open = cur as Session | null
        if (open && rs[ri] >= open.start) {
          open.resolvedAt = rs[ri]
          close()
        }
        ri++
      }
      const open = cur as Session | null
      if (open && open.firstReplyAt !== null && lastAt !== null && m.at - lastAt >= gapMs) close()

      if (m.kind === 'customer') {
        if (!cur) {
          cur = {
            conversationId,
            start: m.at,
            end: m.at,
            firstReplyAt: null,
            firstReplyKind: null,
            firstReplyBy: null,
            firstHumanAt: null,
            firstHumanBy: null,
            resolvedAt: null,
          }
        }
      } else if (cur) {
        const s = cur as Session
        if (s.firstReplyAt === null) {
          s.firstReplyAt = m.at
          s.firstReplyKind = m.kind
          s.firstReplyBy = m.kind === 'agent' ? m.senderId : m.aiAgentId
        }
        if (m.kind === 'agent' && s.firstHumanAt === null) {
          s.firstHumanAt = m.at
          s.firstHumanBy = m.senderId
        }
      }
      if (cur) (cur as Session).end = m.at
      lastAt = m.at
    }
    // Resolves after the last message.
    const open = cur as Session | null
    if (open) {
      const r = rs.find((t) => t >= open.start)
      if (r !== undefined) open.resolvedAt = r
      close()
    }
  }
  out.sort((a, b) => a.start - b.start)
  return out
}

export interface Window {
  from: number
  to: number
}

export const inWindow = (t: number, w: Window) => t >= w.from && t < w.to

export interface ResponseSummary {
  /** Sessions started in the window. */
  sessions: number
  answered: number
  /** Not answered yet (as of `now`). */
  unanswered: number
  answeredByBot: number
  answeredByAgent: number
  medianMs: number | null
  p90Ms: number | null
  humanAnswered: number
  humanMedianMs: number | null
  humanP90Ms: number | null
  slaMinutes: number
  /** Answered sessions + unanswered ones already past the SLA. */
  slaEligible: number
  withinSla: number
  /** withinSla / slaEligible (0..1), null when nothing is eligible. */
  slaRate: number | null
}

/**
 * First-response metrics for sessions that STARTED inside `w`. An
 * unanswered session counts against the SLA only once it is older than
 * the target (a message received a minute ago isn't a breach yet).
 */
export function summarizeResponses(sessions: readonly Session[], w: Window, now: number, slaMinutes: number): ResponseSummary {
  const slaMs = slaMinutes * 60_000
  const frt: number[] = []
  const human: number[] = []
  let answered = 0
  let answeredByBot = 0
  let answeredByAgent = 0
  let unanswered = 0
  let eligible = 0
  let within = 0
  let total = 0
  for (const s of sessions) {
    if (!inWindow(s.start, w)) continue
    total++
    if (s.firstReplyAt !== null) {
      const d = s.firstReplyAt - s.start
      frt.push(d)
      answered++
      if (s.firstReplyKind === 'bot') answeredByBot++
      else answeredByAgent++
      eligible++
      if (d <= slaMs) within++
    } else {
      unanswered++
      if (now - s.start > slaMs && s.resolvedAt === null) eligible++
    }
    if (s.firstHumanAt !== null) human.push(s.firstHumanAt - s.start)
  }
  return {
    sessions: total,
    answered,
    unanswered,
    answeredByBot,
    answeredByAgent,
    medianMs: median(frt),
    p90Ms: percentile(frt, 0.9),
    humanAnswered: human.length,
    humanMedianMs: median(human),
    humanP90Ms: percentile(human, 0.9),
    slaMinutes,
    slaEligible: eligible,
    withinSla: within,
    slaRate: ratio(within, eligible),
  }
}

/** Per-agent first human response (sessions started in `w`). */
export function humanResponseByAgent(sessions: readonly Session[], w: Window): Map<string, { sessions: number; medianMs: number | null }> {
  const lists = new Map<string, number[]>()
  for (const s of sessions) {
    if (!inWindow(s.start, w) || s.firstHumanAt === null || !s.firstHumanBy) continue
    const l = lists.get(s.firstHumanBy) ?? []
    l.push(s.firstHumanAt - s.start)
    lists.set(s.firstHumanBy, l)
  }
  const out = new Map<string, { sessions: number; medianMs: number | null }>()
  for (const [id, l] of lists) out.set(id, { sessions: l.length, medianMs: median(l) })
  return out
}

export interface Closure {
  conversationId: string
  /** Epoch ms of the resolve / close. */
  at: number
  /** Who resolved it (user id), when known. */
  by: string | null
}

export interface ResolutionSummary {
  resolved: number
  /** Resolutions whose session start is known (within the loaded stream). */
  measured: number
  medianMs: number | null
  p90Ms: number | null
  byUser: Map<string, number>
}

/**
 * Resolution time = closure instant − start of the latest session of that
 * conversation that started at or before it. Closures outside `w` are
 * ignored; a closure with no known session is counted but not measured.
 */
export function summarizeResolutions(sessions: readonly Session[], closures: readonly Closure[], w: Window): ResolutionSummary {
  const starts = new Map<string, number[]>()
  for (const s of sessions) {
    const l = starts.get(s.conversationId) ?? []
    l.push(s.start)
    starts.set(s.conversationId, l)
  }
  const durations: number[] = []
  const byUser = new Map<string, number>()
  let resolved = 0
  for (const c of closures) {
    if (!inWindow(c.at, w)) continue
    resolved++
    if (c.by) byUser.set(c.by, (byUser.get(c.by) ?? 0) + 1)
    const l = starts.get(c.conversationId)
    if (!l) continue
    let best: number | null = null
    for (const st of l) if (st <= c.at && (best === null || st > best)) best = st
    if (best !== null) durations.push(c.at - best)
  }
  return { resolved, measured: durations.length, medianMs: median(durations), p90Ms: percentile(durations, 0.9), byUser }
}

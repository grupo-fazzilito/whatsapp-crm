import { describe, expect, it } from 'vitest'
import {
  buildSessions,
  humanResponseByAgent,
  parseStream,
  summarizeResolutions,
  summarizeResponses,
  type StreamMessage,
} from './sessions'

const MIN = 60_000
const H = 60 * MIN
const T0 = Date.UTC(2026, 9, 1, 15, 0) // 2026-10-01 15:00Z

const c = (conv: string, at: number): StreamMessage => ({ conversationId: conv, kind: 'customer', senderId: null, aiAgentId: null, at })
const a = (conv: string, at: number, user = 'u1'): StreamMessage => ({ conversationId: conv, kind: 'agent', senderId: user, aiAgentId: null, at })
const b = (conv: string, at: number, ai = 'ai1'): StreamMessage => ({ conversationId: conv, kind: 'bot', senderId: null, aiAgentId: ai, at })

describe('buildSessions', () => {
  it('opens at the first customer message and records the first reply', () => {
    const s = buildSessions([a('x', T0 + 5 * MIN), c('x', T0), c('x', T0 + MIN)])
    expect(s).toHaveLength(1)
    expect(s[0]).toMatchObject({ start: T0, firstReplyAt: T0 + 5 * MIN, firstReplyKind: 'agent', firstReplyBy: 'u1', firstHumanBy: 'u1' })
  })

  it('outbound messages without a customer message open nothing', () => {
    expect(buildSessions([a('x', T0), b('x', T0 + MIN)])).toEqual([])
  })

  it('splits after ≥24h of silence once answered', () => {
    const s = buildSessions([c('x', T0), b('x', T0 + MIN), c('x', T0 + 25 * H), a('x', T0 + 25 * H + 10 * MIN)])
    expect(s).toHaveLength(2)
    expect(s[0]).toMatchObject({ firstReplyKind: 'bot', firstReplyBy: 'ai1', firstHumanAt: null })
    expect(s[1]).toMatchObject({ start: T0 + 25 * H, firstReplyAt: T0 + 25 * H + 10 * MIN })
  })

  it('does not split a quick back-and-forth', () => {
    const s = buildSessions([c('x', T0), a('x', T0 + MIN), c('x', T0 + 23 * H), a('x', T0 + 23 * H + MIN)])
    expect(s).toHaveLength(1)
  })

  it('keeps an unanswered session open across a long gap (slow reply still counts)', () => {
    const s = buildSessions([c('x', T0), c('x', T0 + 30 * H), a('x', T0 + 31 * H)])
    expect(s).toHaveLength(1)
    expect(s[0].firstReplyAt! - s[0].start).toBe(31 * H)
  })

  it('a resolve closes the session; the next customer message opens a new one', () => {
    const resolves = new Map([['x', [T0 + 10 * MIN]]])
    const s = buildSessions([c('x', T0), a('x', T0 + 2 * MIN), c('x', T0 + 20 * MIN), a('x', T0 + 50 * MIN)], resolves)
    expect(s).toHaveLength(2)
    expect(s[0].resolvedAt).toBe(T0 + 10 * MIN)
    expect(s[1]).toMatchObject({ start: T0 + 20 * MIN, firstReplyAt: T0 + 50 * MIN, resolvedAt: null })
  })

  it('a resolve after the last message is attached; one before the start is ignored', () => {
    const resolves = new Map([['x', [T0 - H, T0 + H]]])
    const s = buildSessions([c('x', T0)], resolves)
    expect(s[0].resolvedAt).toBe(T0 + H)
  })

  it('tracks the first human reply after a bot reply', () => {
    const s = buildSessions([c('x', T0), b('x', T0 + 1000), c('x', T0 + 2 * MIN), a('x', T0 + 12 * MIN, 'u2')])
    expect(s[0]).toMatchObject({ firstReplyKind: 'bot', firstHumanAt: T0 + 12 * MIN, firstHumanBy: 'u2' })
  })

  it('handles several conversations independently', () => {
    const s = buildSessions([c('x', T0), c('y', T0 + MIN), a('y', T0 + 2 * MIN), a('x', T0 + 3 * MIN)])
    expect(s.map((x) => [x.conversationId, x.firstReplyAt! - x.start])).toEqual([
      ['x', 3 * MIN],
      ['y', MIN],
    ])
  })
})

describe('summarizeResponses', () => {
  const w = { from: T0, to: T0 + 24 * H }
  it('computes median, p90 and SLA over sessions started in the window', () => {
    const msgs = [
      c('p', T0 - H), a('p', T0 + MIN), // started before the window → ignored
      c('a', T0), b('a', T0 + 2 * MIN), // 2 min (bot)
      c('b', T0 + H), a('b', T0 + H + 10 * MIN), // 10 min
      c('d', T0 + 2 * H), a('d', T0 + 2 * H + 30 * MIN, 'u2'), // 30 min
      c('e', T0 + 3 * H), // unanswered, breached
      c('f', T0 + 24 * H - 5 * MIN), // unanswered, not yet breached at now
    ]
    const sessions = buildSessions(msgs)
    const r = summarizeResponses(sessions, w, T0 + 24 * H, 15)
    expect(r.sessions).toBe(5)
    expect(r.answered).toBe(3)
    expect(r.unanswered).toBe(2)
    expect(r.answeredByBot).toBe(1)
    expect(r.answeredByAgent).toBe(2)
    expect(r.medianMs).toBe(10 * MIN)
    expect(r.p90Ms).toBe(26 * MIN) // 10 + (30-10)*0.8
    expect(r.humanAnswered).toBe(2)
    expect(r.humanMedianMs).toBe(20 * MIN)
    expect(r.slaEligible).toBe(4)
    expect(r.withinSla).toBe(2)
    expect(r.slaRate).toBe(0.5)

    const per = humanResponseByAgent(sessions, w)
    expect(per.get('u1')).toEqual({ sessions: 1, medianMs: 10 * MIN })
    expect(per.get('u2')).toEqual({ sessions: 1, medianMs: 30 * MIN })
  })

  it('SLA rate is null with nothing eligible', () => {
    expect(summarizeResponses([], w, T0, 15).slaRate).toBeNull()
  })
})

describe('summarizeResolutions', () => {
  it('measures from the latest session start before the closure', () => {
    const sessions = buildSessions([c('x', T0), a('x', T0 + MIN), c('x', T0 + 30 * H), a('x', T0 + 30 * H + MIN), c('y', T0)])
    const w = { from: T0, to: T0 + 48 * H }
    const r = summarizeResolutions(
      sessions,
      [
        { conversationId: 'x', at: T0 + 32 * H, by: 'u1' },
        { conversationId: 'y', at: T0 + H, by: null },
        { conversationId: 'z', at: T0 + H, by: 'u1' }, // unknown session
        { conversationId: 'y', at: T0 + 49 * H, by: 'u1' }, // outside window
      ],
      w,
    )
    expect(r.resolved).toBe(3)
    expect(r.measured).toBe(2)
    expect(r.medianMs).toBe(1.5 * H)
    expect(r.byUser.get('u1')).toBe(2)
  })
})

describe('parseStream', () => {
  it('maps compact rows', () => {
    expect(parseStream([['x', 'a', 'u', null, '1000']])).toEqual([
      { conversationId: 'x', kind: 'agent', senderId: 'u', aiAgentId: null, at: 1000 },
    ])
  })
})

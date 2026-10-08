import { describe, expect, it } from 'vitest'
import { assembleReport, type AssembleInput } from './assemble'
import { resolveRange } from './range'

const NOW = new Date('2026-10-08T15:00:00Z')
const range = resolveRange('custom', 'America/Lima', NOW, { from: '2026-10-01', to: '2026-10-03' })!
const T = Date.parse('2026-10-01T15:00:00Z')

function input(over: Partial<AssembleInput> = {}): AssembleInput {
  return {
    scope: 'workspace',
    userId: 'u1',
    range,
    settings: { slaMinutes: 15, usdRate: 3.75 },
    workspace: { currency: 'PEN', locale: 'es', country: 'PE' },
    filters: { channelId: null, agentId: null, teamId: null },
    options: {
      channels: [{ id: 'ch1', name: 'Web', type: 'webchat', purpose: 'sales' }],
      agents: [{ id: 'u1', name: 'Ana' }, { id: 'u2', name: 'Beto' }],
      teams: null,
      aiAgents: [{ id: 'ai1', name: 'Sofía' }],
    },
    modules: { orders: true, bookings: false },
    volume: {
      by_day: [{ day: '2026-10-02', inbound: 2, agent: 1, bot: 1 }],
      by_channel: [{ channel_id: 'ch1', inbound: 2, agent: 1, bot: 1, conversations: 1 }],
      heatmap: [{ dow: 3, hour: 10, inbound: 2 }],
      by_agent: [{ user_id: 'u1', messages: 1, conversations: 1 }],
      by_ai_agent: [{ ai_agent_id: 'ai1', messages: 1, conversations: 1 }],
      mix: { ai_only: 0, human_only: 0, both: 1, no_reply: 0 },
      conversations_started: 1,
    },
    stream: {
      truncated: false,
      rows: [
        ['c1', 'c', null, null, T],
        ['c1', 'b', null, 'ai1', T + 60_000],
        ['c1', 'a', 'u1', null, T + 10 * 60_000],
      ],
    },
    snapshot: { unanswered: 0, oldest_waiting: null, waiting: [], open_load: [{ user_id: 'u2', open: 3, pending: 1 }] },
    business: {
      orders_by_status: [{ status: 'cancelled', count: 1, total: 20 }, { status: 'pending', count: 2, total: 30 }],
      bookings_by_status: [],
      conversion: { active_conversations: 4, with_order: 1 },
      ai_cost: [{ ai_agent_id: 'ai1', calls: 2, cost_usd: 0.02 }, { ai_agent_id: null, calls: 1, cost_usd: 0.01 }],
      handovers: [{ ai_agent_id: 'ai1', count: 2, conversations: 1 }],
      handover_conversations: 1,
    },
    closures: [{ conversationId: 'c1', at: T + 20 * 60_000, by: 'u1' }],
    basis: 'events',
    now: NOW,
    ...over,
  }
}

describe('assembleReport', () => {
  it('zero-fills days and the heatmap', () => {
    const r = assembleReport(input())
    expect(r.volume.byDay.map((d) => d.day)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03'])
    expect(r.volume.byDay[0]).toEqual({ day: '2026-10-01', inbound: 0, agent: 0, bot: 0 })
    expect(r.volume.heatmap).toHaveLength(7)
    expect(r.volume.heatmap[3][10]).toBe(2)
    expect(r.volume.byPurpose).toEqual([{ purpose: 'sales', inbound: 2, outbound: 2 }])
  })

  it('computes attention metrics from the stream and closures', () => {
    const a = assembleReport(input()).attention
    expect(a.sessions).toBe(1)
    expect(a.medianFirstResponseMs).toBe(60_000)
    expect(a.medianHumanResponseMs).toBe(10 * 60_000)
    expect(a.withinSla).toBe(1)
    expect(a.resolution).toMatchObject({ basis: 'events', resolved: 1, medianMs: 20 * 60_000 })
  })

  it('merges team rows from messages, responses, resolutions and open load', () => {
    const { agents } = assembleReport(input()).team
    expect(agents.find((x) => x.userId === 'u1')).toMatchObject({ name: 'Ana', messages: 1, firstResponses: 1, resolved: 1 })
    expect(agents.find((x) => x.userId === 'u2')).toMatchObject({ name: 'Beto', open: 3, pending: 1, messages: 0 })
  })

  it('personal scope keeps only the caller and drops AI / sales', () => {
    const r = assembleReport(input({ scope: 'personal', business: null }))
    expect(r.team.agents.map((x) => x.userId)).toEqual(['u1'])
    expect(r.ai).toBeNull()
    expect(r.sales).toBeNull()
  })

  it('AI rows include cost without an agent and local conversion', () => {
    const ai = assembleReport(input()).ai!
    expect(ai.totalCostUsd).toBeCloseTo(0.03)
    expect(ai.totalCostLocal).toBeCloseTo(0.1125)
    const s = ai.agents.find((x) => x.aiAgentId === 'ai1')!
    expect(s).toMatchObject({ name: 'Sofía', replies: 1, handovers: 1, handoverRate: 1, calls: 2 })
    expect(ai.agents.find((x) => x.aiAgentId === null)?.costUsd).toBe(0.01)
  })

  it('orders sorted by lifecycle; revenue excludes cancelled', () => {
    const s = assembleReport(input()).sales!
    expect(s.ordersByStatus.map((x) => x.status)).toEqual(['pending', 'cancelled'])
    expect(s.revenue).toBe(30)
    expect(s.conversion.rate).toBe(0.25)
  })

  it('no sales block when neither module is on', () => {
    expect(assembleReport(input({ modules: { orders: false, bookings: false } })).sales).toBeNull()
  })
})

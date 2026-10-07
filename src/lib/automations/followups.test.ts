import { beforeEach, describe, expect, it, vi } from 'vitest'

// Minimal PostgREST-style fake: records every call of a chain and resolves
// with the result queued for that table.
type Call = { table: string; ops: [string, ...unknown[]][] }
const calls: Call[] = []
const results: Record<string, unknown> = {}

function builder(table: string) {
  const call: Call = { table, ops: [] }
  calls.push(call)
  const proxy: Record<string, unknown> = {}
  for (const op of ['select', 'eq', 'update', 'upsert', 'lte', 'order', 'limit', 'maybeSingle', 'in']) {
    proxy[op] = (...args: unknown[]) => {
      call.ops.push([op, ...args])
      return proxy
    }
  }
  proxy.then = (resolve: (v: unknown) => unknown) => resolve(results[table] ?? { data: null, error: null })
  return proxy
}

vi.mock('./admin-client', () => ({ supabaseAdmin: () => ({ from: (t: string) => builder(t) }) }))

import { armFollowupsForOutbound, cancelFollowupsForInbound } from './followups'

const NOW = new Date('2026-10-07T12:00:00.000Z')
const base = {
  workspaceId: 'ws1',
  conversationId: 'cv1',
  contactId: 'ct1',
  channelId: 'ch1',
  messageId: 'm1',
  status: 'sent',
  now: NOW,
}

beforeEach(() => {
  calls.length = 0
  for (const k of Object.keys(results)) delete results[k]
})

describe('armFollowupsForOutbound', () => {
  it('upserts one schedule per matching active no_reply automation', async () => {
    results.automations = {
      data: [
        { id: 'a1', trigger_config: { after: { amount: 2, unit: 'hours' } } },
        { id: 'a2', trigger_config: { after: { amount: 1, unit: 'days' }, channel_ids: ['other'] } },
        { id: 'a3', trigger_config: { after: { amount: 0, unit: 'hours' } } },
      ],
      error: null,
    }
    const n = await armFollowupsForOutbound(base)
    expect(n).toBe(1)

    const lookup = calls.find((c) => c.table === 'automations')!
    expect(lookup.ops).toContainEqual(['eq', 'workspace_id', 'ws1'])
    expect(lookup.ops).toContainEqual(['eq', 'trigger_type', 'no_reply'])
    expect(lookup.ops).toContainEqual(['eq', 'is_active', true])

    const up = calls.find((c) => c.table === 'followup_schedules')!
    const [, rows, opts] = up.ops.find((o) => o[0] === 'upsert')!
    expect(opts).toEqual({ onConflict: 'automation_id,conversation_id' })
    expect(rows).toEqual([
      expect.objectContaining({
        workspace_id: 'ws1',
        automation_id: 'a1',
        conversation_id: 'cv1',
        anchor_message_id: 'm1',
        due_at: '2026-10-07T14:00:00.000Z',
        status: 'pending',
      }),
    ])
  })

  it('does nothing for follow-up sends, failures and broadcasts (no DB calls)', async () => {
    expect(await armFollowupsForOutbound({ ...base, metadata: { followup: true } })).toBe(0)
    expect(await armFollowupsForOutbound({ ...base, status: 'failed' })).toBe(0)
    expect(await armFollowupsForOutbound({ ...base, metadata: { source: 'broadcast' } })).toBe(0)
    expect(calls).toEqual([])
  })

  it('does not upsert when no automation applies', async () => {
    results.automations = { data: [], error: null }
    expect(await armFollowupsForOutbound(base)).toBe(0)
    expect(calls.map((c) => c.table)).toEqual(['automations'])
  })
})

describe('cancelFollowupsForInbound', () => {
  it('cancels pending schedules and parked follow-up waits of the conversation', async () => {
    await cancelFollowupsForInbound('ws1', 'cv1')
    const sched = calls.find((c) => c.table === 'followup_schedules')!
    expect(sched.ops[0]).toEqual(['update', expect.objectContaining({ status: 'cancelled' })])
    expect(sched.ops).toContainEqual(['eq', 'workspace_id', 'ws1'])
    expect(sched.ops).toContainEqual(['eq', 'conversation_id', 'cv1'])
    expect(sched.ops).toContainEqual(['eq', 'status', 'pending'])

    const waits = calls.find((c) => c.table === 'automation_pending_executions')!
    expect(waits.ops[0]).toEqual(['update', { status: 'cancelled' }])
    expect(waits.ops).toContainEqual(['eq', 'context->>conversation_id', 'cv1'])
    expect(waits.ops).toContainEqual(['eq', 'context->>followup', 'true'])
    expect(waits.ops).toContainEqual(['eq', 'status', 'pending'])
  })

  it('throws when the DB fails (callers log it)', async () => {
    results.followup_schedules = { data: null, error: { message: 'boom' } }
    await expect(cancelFollowupsForInbound('ws1', 'cv1')).rejects.toThrow('boom')
  })
})

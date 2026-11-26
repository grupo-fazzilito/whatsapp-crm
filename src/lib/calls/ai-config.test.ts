import { describe, expect, it } from 'vitest'
import { billableMinutes, DEFAULT_CALL_AI, inCustomHours, normalizeCallAi, normalizeHours, planAnswer, readCallAi, type CallAiConfig } from './ai-config'
import type { BusinessHoursRow } from '@/lib/ai/slots'

const AGENT = '11111111-2222-4333-8444-555555555555'
const TZ = 'America/Lima' // UTC-5, no DST

// Weekdays 09:00–18:00, weekend closed.
const HOURS: BusinessHoursRow[] = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].map((day_name) => ({
  day_name,
  opening_time: '09:00',
  closing_time: '18:00',
  is_closed: false,
  break_start: null,
  break_end: null,
}))
HOURS.push(
  { day_name: 'Saturday', opening_time: null, closing_time: null, is_closed: true, break_start: null, break_end: null },
  { day_name: 'Sunday', opening_time: null, closing_time: null, is_closed: true, break_start: null, break_end: null },
)

// 2026-11-25 is a Wednesday. 15:00 UTC = 10:00 in Lima; 02:00 UTC next day = 21:00 Wednesday in Lima.
const OPEN = new Date('2026-11-25T15:00:00Z')
const CLOSED = new Date('2026-11-26T02:00:00Z')

const cfg = (patch: Partial<CallAiConfig>): CallAiConfig => ({ ...DEFAULT_CALL_AI, agent_id: AGENT, ...patch })
const plan = (config: CallAiConfig, now: Date) => planAnswer({ config, timeZone: TZ, hours: HOURS, exceptions: [], now })

describe('normalizeCallAi', () => {
  it('fills defaults and rejects bad values', () => {
    expect(normalizeCallAi(null)).toEqual(DEFAULT_CALL_AI)
    const n = normalizeCallAi({ mode: 'robot', agent_id: 'x', voice: 'nope', fallback_seconds: 999, max_minutes: 0, greeting: '  Hola  ' })
    expect(n.mode).toBe('humans')
    expect(n.agent_id).toBeNull()
    expect(n.voice).toBe('marin')
    expect(n.fallback_seconds).toBe(45)
    expect(n.max_minutes).toBe(1)
    expect(n.greeting).toBe('Hola')
  })

  it('keeps a valid config', () => {
    const c = cfg({ mode: 'schedule', schedule: 'custom', custom_hours: [{ day: 1, from: '08:00', to: '12:00' }], voice: 'cedar' })
    expect(normalizeCallAi(c)).toEqual(c)
  })

  it('reads it from channels.settings.calling.ai', () => {
    expect(readCallAi({ calling: { enabled: true, ai: { mode: 'ai', agent_id: AGENT } } }).mode).toBe('ai')
    expect(readCallAi({}).mode).toBe('humans')
  })
})

describe('normalizeHours', () => {
  it('drops invalid and reversed ranges, sorts by day', () => {
    expect(
      normalizeHours([
        { day: 3, from: '10:00', to: '12:00' },
        { day: 1, from: '18:00', to: '09:00' },
        { day: 9, from: '10:00', to: '11:00' },
        { day: 1, from: '25:00', to: '26:00' },
        { day: 0, from: '09:00', to: '13:00' },
      ]),
    ).toEqual([
      { day: 0, from: '09:00', to: '13:00' },
      { day: 3, from: '10:00', to: '12:00' },
    ])
  })
})

describe('planAnswer', () => {
  it('humans, or no agent: never the AI', () => {
    expect(plan(cfg({ mode: 'humans' }), OPEN)).toEqual({ kind: 'humans' })
    expect(plan({ ...cfg({ mode: 'ai' }), agent_id: null }, OPEN)).toEqual({ kind: 'humans' })
  })

  it('ai: always the AI', () => {
    expect(plan(cfg({ mode: 'ai' }), OPEN)).toEqual({ kind: 'ai' })
    expect(plan(cfg({ mode: 'ai' }), CLOSED)).toEqual({ kind: 'ai' })
  })

  it('schedule outside business hours', () => {
    const c = cfg({ mode: 'schedule', schedule: 'outside_business_hours' })
    expect(plan(c, OPEN)).toEqual({ kind: 'humans' })
    expect(plan(c, CLOSED)).toEqual({ kind: 'ai' })
  })

  it('schedule during business hours', () => {
    const c = cfg({ mode: 'schedule', schedule: 'business_hours' })
    expect(plan(c, OPEN)).toEqual({ kind: 'ai' })
    expect(plan(c, CLOSED)).toEqual({ kind: 'humans' })
  })

  it('schedule on custom hours (business time zone)', () => {
    const c = cfg({ mode: 'schedule', schedule: 'custom', custom_hours: [{ day: 3, from: '20:00', to: '23:00' }] })
    expect(plan(c, CLOSED)).toEqual({ kind: 'ai' }) // Wednesday 21:00 in Lima
    expect(plan(c, OPEN)).toEqual({ kind: 'humans' })
  })

  it('a closed exception day counts as outside hours', () => {
    const c = cfg({ mode: 'schedule', schedule: 'outside_business_hours' })
    const r = planAnswer({ config: c, timeZone: TZ, hours: HOURS, exceptions: [{ date: '2026-11-25', is_closed: true } as never], now: OPEN })
    expect(r).toEqual({ kind: 'ai' })
  })

  it('fallback: rings first, then the AI', () => {
    expect(plan(cfg({ mode: 'fallback', fallback_seconds: 15 }), OPEN)).toEqual({ kind: 'fallback', afterSeconds: 15 })
  })
})

describe('inCustomHours', () => {
  it('end of range is exclusive', () => {
    const ranges = [{ day: 3, from: '09:00', to: '10:00' }]
    expect(inCustomHours(ranges, TZ, new Date('2026-11-25T14:59:00Z'))).toBe(true)
    expect(inCustomHours(ranges, TZ, new Date('2026-11-25T15:00:00Z'))).toBe(false)
  })
})

describe('billableMinutes', () => {
  it('counts started minutes', () => {
    expect(billableMinutes(null)).toBe(0)
    expect(billableMinutes(0)).toBe(0)
    expect(billableMinutes(1)).toBe(1)
    expect(billableMinutes(60)).toBe(1)
    expect(billableMinutes(61)).toBe(2)
  })
})

// Who answers a WhatsApp call: the team (rings the inbox) or an AI agent
// (voice service). Pure: config parsing and the decision at ring time.
// Stored in channels.settings.calling.ai.

import { businessWindows, type BusinessException, type BusinessHoursRow } from '@/lib/ai/slots'
import { toMinutes, zonedNow } from '@/lib/ai/time'

/**
 * humans    only people (rings the inbox)
 * ai        only the AI agent
 * schedule  the AI inside its hours, people the rest of the time
 * fallback  rings the inbox; the AI answers if nobody did in N seconds
 */
export const CALL_ANSWER_MODES = ['humans', 'ai', 'schedule', 'fallback'] as const
export type CallAnswerMode = (typeof CALL_ANSWER_MODES)[number]

/** When the AI answers in "schedule" mode. */
export const AI_SCHEDULES = ['outside_business_hours', 'business_hours', 'custom'] as const
export type AiSchedule = (typeof AI_SCHEDULES)[number]

/** OpenAI Realtime voices. */
export const AI_VOICES = ['marin', 'cedar', 'alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse'] as const
export type AiVoice = (typeof AI_VOICES)[number]

/** A range of the AI's own hours; day 0 = Sunday. */
export interface AiHoursRange {
  day: number
  from: string
  to: string
}

export interface CallAiConfig {
  mode: CallAnswerMode
  agent_id: string | null
  schedule: AiSchedule
  custom_hours: AiHoursRange[]
  /** fallback: seconds ringing before the AI picks up. */
  fallback_seconds: number
  voice: AiVoice
  /** First sentence of the AI; empty = the agent's own greeting or a default one. */
  greeting: string
  /** The AI says goodbye and hangs up after this long. */
  max_minutes: number
}

export const DEFAULT_CALL_AI: CallAiConfig = {
  mode: 'humans',
  agent_id: null,
  schedule: 'outside_business_hours',
  custom_hours: [],
  fallback_seconds: 20,
  voice: 'marin',
  greeting: '',
  max_minutes: 10,
}

export const FALLBACK_SECONDS = { min: 5, max: 45 }
export const MAX_MINUTES = { min: 1, max: 30 }
export const GREETING_MAX = 300

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback
}

function pick<T extends string>(list: readonly T[], v: unknown, fallback: T): T {
  return typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : fallback
}

/** Valid ranges only (from < to, same day), at most 3 per day. */
export function normalizeHours(raw: unknown): AiHoursRange[] {
  if (!Array.isArray(raw)) return []
  const out: AiHoursRange[] = []
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue
    const { day, from, to } = r as Record<string, unknown>
    const d = typeof day === 'number' ? day : Number(day)
    if (!Number.isInteger(d) || d < 0 || d > 6) continue
    if (typeof from !== 'string' || typeof to !== 'string' || !HHMM.test(from) || !HHMM.test(to) || from >= to) continue
    if (out.filter((x) => x.day === d).length >= 3) continue
    out.push({ day: d, from, to })
  }
  return out.sort((a, b) => a.day - b.day || a.from.localeCompare(b.from))
}

/** Whatever was stored or sent → a complete, valid config. */
export function normalizeCallAi(raw: unknown): CallAiConfig {
  const v = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  return {
    mode: pick(CALL_ANSWER_MODES, v.mode, DEFAULT_CALL_AI.mode),
    agent_id: typeof v.agent_id === 'string' && UUID.test(v.agent_id) ? v.agent_id : null,
    schedule: pick(AI_SCHEDULES, v.schedule, DEFAULT_CALL_AI.schedule),
    custom_hours: normalizeHours(v.custom_hours),
    fallback_seconds: clampInt(v.fallback_seconds, FALLBACK_SECONDS.min, FALLBACK_SECONDS.max, DEFAULT_CALL_AI.fallback_seconds),
    voice: pick(AI_VOICES, v.voice, DEFAULT_CALL_AI.voice),
    greeting: typeof v.greeting === 'string' ? v.greeting.trim().slice(0, GREETING_MAX) : '',
    max_minutes: clampInt(v.max_minutes, MAX_MINUTES.min, MAX_MINUTES.max, DEFAULT_CALL_AI.max_minutes),
  }
}

export function readCallAi(settings: Record<string, unknown> | null | undefined): CallAiConfig {
  const calling = settings?.calling as Record<string, unknown> | undefined
  return normalizeCallAi(calling?.ai)
}

const WEEKDAY_INDEX: Record<string, number> = { Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6 }

export interface DecideInput {
  config: CallAiConfig
  timeZone: string
  hours: BusinessHoursRow[]
  exceptions: BusinessException[]
  now?: Date
}

/** True while the business is open (its hours, breaks and exceptions). */
export function businessOpenAt(input: Omit<DecideInput, 'config'>): boolean {
  const now = zonedNow(input.timeZone, input.now)
  const windows = businessWindows(now.date, input.hours, input.exceptions)
  const m = toMinutes(now.time) ?? 0
  return !!windows?.some((w) => m >= w.start && m < w.end)
}

/** True inside the AI's own custom hours. */
export function inCustomHours(ranges: AiHoursRange[], timeZone: string, now?: Date): boolean {
  const z = zonedNow(timeZone, now)
  const day = WEEKDAY_INDEX[z.weekday]
  return ranges.some((r) => r.day === day && z.time >= r.from && z.time < r.to)
}

/** Whether the AI is on duty right now in "schedule" mode. */
export function aiOnDuty(input: DecideInput): boolean {
  const { config } = input
  if (config.schedule === 'custom') return inCustomHours(config.custom_hours, input.timeZone, input.now)
  const open = businessOpenAt(input)
  return config.schedule === 'business_hours' ? open : !open
}

/**
 * What happens when a call rings:
 *   humans    → ring the inbox only
 *   ai        → the AI answers right away
 *   fallback  → ring the inbox; the AI answers after config.fallback_seconds
 */
export type AnswerPlan = { kind: 'humans' } | { kind: 'ai' } | { kind: 'fallback'; afterSeconds: number }

export function planAnswer(input: DecideInput): AnswerPlan {
  const { config } = input
  if (!config.agent_id) return { kind: 'humans' }
  switch (config.mode) {
    case 'ai':
      return { kind: 'ai' }
    case 'schedule':
      return aiOnDuty(input) ? { kind: 'ai' } : { kind: 'humans' }
    case 'fallback':
      return { kind: 'fallback', afterSeconds: config.fallback_seconds }
    default:
      return { kind: 'humans' }
  }
}

/** Minutes billed for a call that lasted `seconds` (any started minute counts). */
export function billableMinutes(seconds: number | null | undefined): number {
  const s = Math.max(0, Math.round(seconds ?? 0))
  return s === 0 ? 0 : Math.ceil(s / 60)
}

// Booking picker — pure helpers (no DB), shared by the server module and
// its tests. The customer books by tapping: product / service / staff when
// needed → day → time, then the few required fields the business asks for.
//
// Reply ids: `bk:<step>:<value>`. The tapped id only counts when it belongs
// to the step the picker is on (an old list tapped later is ignored), and a
// typed answer ("2", "jueves", "10:30") matches the options on screen.

import { matchTypedOption } from '@/lib/flows/options'

export const PICKER_PREFIX = 'bk:'

export type PickerStep = 'product' | 'service' | 'staff' | 'day' | 'time' | 'field'
export type PickerOrigin = 'flow' | 'inbox'
/** How a picker ended, also the flow step's exits. */
export type PickerOutcome = 'booked' | 'link' | 'not_booked'

export interface PickerOption {
  /** Value of the choice (an id, a date, a time, or `more:<offset>`). */
  id: string
  title: string
  description?: string
}

export interface PickerDraft {
  service_id?: string | null
  staff_id?: string | null
  product_id?: string | null
  date?: string | null
  time?: string | null
  customer_name?: string | null
  party_size?: number | null
  fields?: Record<string, string | number | null>
}

export interface PickerState {
  step: PickerStep
  /** Field being asked while step === 'field'. */
  field?: string
  options: PickerOption[]
  draft: PickerDraft
  /** First time shown on the current time page. */
  offset?: number
  origin: PickerOrigin
  flow?: { run_id: string; node_key: string }
  /** Team member who sent it from the inbox. */
  started_by?: string | null
  /** Unrecognized replies in a row. */
  misses: number
  expires_at: string
}

export const PICKER_TTL_MS = 24 * 3600_000
/** WhatsApp list cap (rows across sections). */
export const MAX_ROWS = 10
export const ROW_TITLE_MAX = 24
export const ROW_DESCRIPTION_MAX = 72
/** Days ahead the picker looks for free times. */
export const PICKER_DAYS = 14
/** Unrecognized replies before a flow's picker gives up. */
export const MAX_MISSES = 2

export function isPickerReply(id: string | null | undefined): id is string {
  return !!id && id.startsWith(PICKER_PREFIX)
}

export function pickerReplyId(step: PickerStep, value: string): string {
  return `${PICKER_PREFIX}${step}:${value}`
}

export function parsePickerReply(id: string): { step: PickerStep; value: string } | null {
  if (!isPickerReply(id)) return null
  const rest = id.slice(PICKER_PREFIX.length)
  const i = rest.indexOf(':')
  if (i < 1) return null
  const step = rest.slice(0, i) as PickerStep
  const value = rest.slice(i + 1)
  if (!['product', 'service', 'staff', 'day', 'time'].includes(step) || !value) return null
  return { step, value }
}

/** The option the customer chose on the current step (tapped or typed), or null. */
export function chosenOption(state: Pick<PickerState, 'step' | 'options'>, reply: { replyId?: string | null; text?: string | null }): PickerOption | null {
  if (reply.replyId) {
    const parsed = parsePickerReply(reply.replyId)
    if (parsed && parsed.step === state.step) {
      const hit = state.options.find((o) => o.id === parsed.value)
      if (hit) return hit
    }
    if (parsed) return null
  }
  const text = reply.text?.trim()
  if (!text) return null
  const typed = matchTypedOption(state.options, text)
  if (typed) return typed
  // "10:30", "10.30", "1030" on the time step.
  if (state.step === 'time') {
    const m = text.match(/^(\d{1,2})[:.h]?(\d{2})$/)
    if (m) {
      const hhmm = `${m[1].padStart(2, '0')}:${m[2]}`
      return state.options.find((o) => o.id === hhmm) ?? null
    }
  }
  return null
}

/** A list row within WhatsApp's limits: long names move whole into the description. */
export function row(id: string, title: string, description?: string | null): PickerOption {
  const clean = title.trim()
  if (clean.length <= ROW_TITLE_MAX) return { id, title: clean, ...(description ? { description: description.slice(0, ROW_DESCRIPTION_MAX) } : {}) }
  return { id, title: `${clean.slice(0, ROW_TITLE_MAX - 1).trimEnd()}…`, description: (description ? `${clean} · ${description}` : clean).slice(0, ROW_DESCRIPTION_MAX) }
}

/** "jue 23 oct" / "Thu, Oct 23" for a YYYY-MM-DD date. */
export function shortDay(date: string, lang: 'es' | 'en'): string {
  const [y, m, d] = date.split('-').map(Number)
  if (!y || !m || !d) return date
  const fmt = new Intl.DateTimeFormat(lang === 'en' ? 'en-US' : 'es-ES', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
  return fmt.format(new Date(Date.UTC(y, m - 1, d))).replace(/\./g, '').replace(/,(?=\s\d)/, '')
}

/**
 * One page of times: all of them when they fit, otherwise 9 and a
 * "more" row that continues from the next one (wrapping to the start).
 */
export function timePage(times: string[], offset: number): { times: string[]; nextOffset: number | null } {
  if (times.length <= MAX_ROWS) return { times, nextOffset: null }
  const start = offset > 0 && offset < times.length ? offset : 0
  const page = times.slice(start, start + MAX_ROWS - 1)
  const next = start + page.length
  return { times: page, nextOffset: next < times.length ? next : 0 }
}

/** First `max` dates that have at least one free time. */
export function daysWithTimes(byDate: Record<string, string[]>, dates: string[], max = MAX_ROWS): { date: string; count: number }[] {
  return dates
    .map((date) => ({ date, count: byDate[date]?.length ?? 0 }))
    .filter((d) => d.count > 0)
    .slice(0, max)
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/** A typed field answer, or null when it isn't valid for the field. */
export function parseFieldAnswer(field: { key: string; type: 'text' | 'number' | 'email' }, text: string): string | number | null {
  const v = text.trim()
  if (!v) return null
  if (field.type === 'email') return EMAIL.test(v) ? v.toLowerCase() : null
  if (field.type === 'number') {
    const n = Number(v.replace(',', '.').match(/\d+(?:\.\d+)?/)?.[0])
    return Number.isFinite(n) && n > 0 ? n : null
  }
  return v.slice(0, 200)
}

// Deterministic lead scoring (0-100) and temperature. Pure: unit-tested.
//
//   completeness  30  8 profile facts known
//   budget        15  a budget (min or max) is defined
//   financing     20  cash 20 · mortgage pre-approved 18 · mortgage 8
//   timeframe     20  ≤3 months 20 · ≤6 12 · ≤12 6 · later 2
//   engagement    15  customer messages (≤8) + 7 with a viewing booked
//
// Temperature: ≥70 hot, ≥40 warm, else cold. Post-visit feedback
// overrides it: "interested" → hot; "not convinced" → at most warm/cold.

import type { LeadFields, Temperature, VisitFeedback } from './types'
import { norm } from './profile'

export interface Engagement {
  /** Customer messages in the conversation(s). */
  inboundMessages?: number
  /** Viewings booked (any status but cancelled). */
  viewings?: number
  /** Latest post-visit answer, if any. */
  visitFeedback?: VisitFeedback | null
}

export interface LeadScore {
  score: number
  temperature: Temperature
  breakdown: { completeness: number; budget: number; financing: number; timeframe: number; engagement: number }
  /** Months until the move-in date, when understood. */
  months: number | null
}

const NUMBER_WORDS: Record<string, number> = {
  un: 1, uno: 1, una: 1, one: 1, a: 1, an: 1,
  dos: 2, two: 2, tres: 3, three: 3, cuatro: 4, four: 4, cinco: 5, five: 5,
  seis: 6, six: 6, siete: 7, seven: 7, ocho: 8, eight: 8, nueve: 9, nine: 9,
  diez: 10, ten: 10, once: 11, eleven: 11, doce: 12, twelve: 12,
}

const MONTHS = [
  ['enero', 'january', 'jan', 'ene'],
  ['febrero', 'february', 'feb'],
  ['marzo', 'march', 'mar'],
  ['abril', 'april', 'apr', 'abr'],
  ['mayo', 'may'],
  ['junio', 'june', 'jun'],
  ['julio', 'july', 'jul'],
  ['agosto', 'august', 'aug', 'ago'],
  ['septiembre', 'setiembre', 'september', 'sep', 'sept', 'set'],
  ['octubre', 'october', 'oct'],
  ['noviembre', 'november', 'nov'],
  ['diciembre', 'december', 'dec', 'dic'],
]

/**
 * Months from `now` until the customer wants to move / buy, from free
 * text ("el próximo mes", "en 3 meses", "marzo", "2027-02", "inmediato").
 * Null when it can't be understood.
 */
export function monthsUntilMoveIn(text: string | null | undefined, now: Date): number | null {
  if (!text) return null
  const v = norm(text)
  if (!v) return null
  if (/(inmediat|ya mismo|cuanto antes|lo antes posible|asap|right away|immediately|urgent|now\b|ahora|esta semana|this week|este mes|this month|hoy|today)/.test(v)) return 0
  if (/(proximo mes|siguiente mes|el otro mes|mes que viene|next month|in a month|en un mes)/.test(v)) return 1
  if (/(medio ano|half a year)/.test(v)) return 6
  if (/(proximo ano|el otro ano|ano que viene|next year)/.test(v)) return 12

  const iso = /\b(20\d{2})-(\d{1,2})(?:-(\d{1,2}))?\b/.exec(v)
  if (iso) {
    const diff = (Number(iso[1]) - now.getUTCFullYear()) * 12 + (Number(iso[2]) - 1 - now.getUTCMonth())
    return Math.max(0, diff)
  }

  const qty = /\b(\d+(?:[.,]\d+)?|un|uno|una|one|a|an|dos|two|tres|three|cuatro|four|cinco|five|seis|six|siete|seven|ocho|eight|nueve|nine|diez|ten|once|eleven|doce|twelve)\s*(semanas?|weeks?|mes(?:es)?|months?|anos?|years?|dias?|days?)\b/.exec(v)
  if (qty) {
    const n = /^\d/.test(qty[1]) ? Number(qty[1].replace(',', '.')) : NUMBER_WORDS[qty[1]] ?? NaN
    if (Number.isFinite(n)) {
      const unit = qty[2]
      if (/^(semana|week)/.test(unit)) return Math.round((n / 4.345) * 10) / 10
      if (/^(dia|day)/.test(unit)) return Math.round((n / 30) * 10) / 10
      if (/^(ano|year)/.test(unit)) return n * 12
      return n
    }
  }

  for (let i = 0; i < MONTHS.length; i++) {
    if (MONTHS[i].some((m) => new RegExp(`\\b${m}\\b`).test(v))) {
      // "mayo" is also the Spanish word for "May" only; ambiguous short
      // English forms ("may", "mar") need a month context word.
      const name = MONTHS[i].find((m) => new RegExp(`\\b${m}\\b`).test(v))!
      if (name.length <= 3 && !/\b(de|en|in|for|para|del)\b/.test(v)) continue
      let diff = i - now.getUTCMonth()
      const year = /\b(20\d{2})\b/.exec(v)
      if (year) diff += (Number(year[1]) - now.getUTCFullYear()) * 12
      else if (diff < 0) diff += 12
      return Math.max(0, diff)
    }
  }
  return null
}

function completeness(f: Partial<LeadFields>): number {
  const facts = [
    !!f.operation,
    !!f.zones?.length,
    !!(f.budget_max || f.budget_min),
    !!f.property_types?.length,
    f.bedrooms_min != null,
    !!f.financing && f.financing !== 'unknown',
    !!f.move_in,
    !!f.purpose && f.purpose !== 'unknown',
  ]
  return Math.round((facts.filter(Boolean).length / facts.length) * 30)
}

export function computeLeadScore(f: Partial<LeadFields>, engagement: Engagement = {}, now: Date = new Date()): LeadScore {
  const months = monthsUntilMoveIn(f.move_in, now)
  const breakdown = {
    completeness: completeness(f),
    budget: f.budget_max || f.budget_min ? 15 : 0,
    financing: f.financing === 'cash' ? 20 : f.mortgage_preapproved ? 18 : f.financing === 'mortgage' ? 8 : 0,
    timeframe: months === null ? 0 : months <= 3 ? 20 : months <= 6 ? 12 : months <= 12 ? 6 : 2,
    engagement: Math.min(15, Math.min(8, Math.max(0, engagement.inboundMessages ?? 0)) + ((engagement.viewings ?? 0) > 0 ? 7 : 0)),
  }
  const score = Math.max(0, Math.min(100, Object.values(breakdown).reduce((a, b) => a + b, 0)))
  let temperature: Temperature = score >= 70 ? 'hot' : score >= 40 ? 'warm' : 'cold'
  if (engagement.visitFeedback === 'interested') temperature = 'hot'
  else if (engagement.visitFeedback === 'not_convinced') temperature = score >= 70 ? 'warm' : 'cold'
  return { score, temperature, breakdown, months }
}

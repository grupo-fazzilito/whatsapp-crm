// Validation of AI agent writes from the agents screen (POST/PATCH
// /api/agents). Pure. Unknown keys are ignored; the shapes match the
// ai_agents columns the editor sends.

import { isUuid } from '@/lib/workspace/constants'

export const AGENT_LANGUAGES = ['auto', 'es', 'en'] as const

const TEXT_FIELDS = ['description', 'persona', 'instructions', 'greeting_message', 'after_hours_message'] as const
const MAX_TEXT = 20_000
const MAX_NAME = 120
const MAX_LIST = 100
const MAX_ITEM = 100

export interface AgentInput {
  name?: string
  description?: string | null
  persona?: string | null
  tone?: string
  instructions?: string | null
  language?: (typeof AGENT_LANGUAGES)[number]
  skills?: string[]
  greeting_message?: string | null
  after_hours_message?: string | null
  escalation_keywords?: string[]
  business_hours_only?: boolean
  enabled?: boolean
  model?: string | null
  transfer_agent_ids?: string[]
}

type Parsed = { ok: true; value: AgentInput } | { ok: false; error: string }

function stringList(v: unknown, field: string): string[] | string {
  if (!Array.isArray(v) || v.length > MAX_LIST) return `${field} must be a list of up to ${MAX_LIST} items`
  const out: string[] = []
  for (const item of v) {
    if (typeof item !== 'string') return `${field} must contain text`
    const s = item.trim()
    if (s.length > MAX_ITEM) return `${field} items are too long`
    if (s && !out.includes(s)) out.push(s)
  }
  return out
}

/** `partial` = PATCH (every field optional); otherwise `name` is required. */
export function parseAgentInput(body: Record<string, unknown>, partial: boolean): Parsed {
  const value: AgentInput = {}

  if ('name' in body || !partial) {
    if (typeof body.name !== 'string' || !body.name.trim()) return { ok: false, error: 'name is required' }
    if (body.name.trim().length > MAX_NAME) return { ok: false, error: 'name is too long' }
    value.name = body.name.trim()
  }
  for (const f of TEXT_FIELDS) {
    if (!(f in body)) continue
    const v = body[f]
    if (v === null) value[f] = null
    else if (typeof v === 'string') {
      if (v.length > MAX_TEXT) return { ok: false, error: `${f} is too long` }
      value[f] = v.trim() ? v.trim() : null
    } else return { ok: false, error: `${f} must be text` }
  }
  if ('tone' in body) {
    if (typeof body.tone !== 'string' || !body.tone.trim() || body.tone.length > 50) return { ok: false, error: 'invalid tone' }
    value.tone = body.tone.trim()
  }
  if ('language' in body) {
    if (!(AGENT_LANGUAGES as readonly unknown[]).includes(body.language)) return { ok: false, error: 'invalid language' }
    value.language = body.language as AgentInput['language']
  }
  for (const f of ['skills', 'escalation_keywords'] as const) {
    if (!(f in body)) continue
    const list = stringList(body[f], f)
    if (typeof list === 'string') return { ok: false, error: list }
    value[f] = list
  }
  for (const f of ['business_hours_only', 'enabled'] as const) {
    if (!(f in body)) continue
    if (typeof body[f] !== 'boolean') return { ok: false, error: `${f} must be true or false` }
    value[f] = body[f] as boolean
  }
  if ('model' in body) {
    const m = body.model
    if (m === null || m === '') value.model = null
    else if (typeof m === 'string' && m.length <= 100) value.model = m.trim()
    else return { ok: false, error: 'invalid model' }
  }
  if ('transfer_agent_ids' in body) {
    const ids = body.transfer_agent_ids
    if (!Array.isArray(ids) || ids.length > MAX_LIST || !ids.every((x) => typeof x === 'string' && isUuid(x))) {
      return { ok: false, error: 'transfer_agent_ids must be agent ids' }
    }
    value.transfer_agent_ids = [...new Set(ids as string[])]
  }
  return { ok: true, value }
}

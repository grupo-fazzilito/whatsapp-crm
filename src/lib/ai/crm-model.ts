// What the AI agent writes in the CRM after a turn: the customer's data,
// the deal's stage, tags, a task and a summary note. Pure — the prompt
// section, the output schema and the decisions; crm.ts does the writes.
import { normalizeValue, optionsOf, type CustomField } from '@/lib/crm/custom-fields'

/** Field the system creates in every business for facts that have no field of their own. */
export const EXTRA_INFO_KEY = 'ai_extra_info'
export const EXTRA_INFO_NAME = { es: 'Más información del cliente', en: 'More about the customer' } as const
const EXTRA_INFO_MAX = 5000

export interface CrmOutput {
  contact?: {
    name?: string
    email?: string
    phone?: string
    company?: string
    fields?: { field_id: string; value: string }[]
    /** Other useful facts the customer told (allergies, size, preferences…). */
    extra_info?: string
  }
  deal_stage_id?: string
  deal_title?: string
  deal_value?: number
  tag_ids?: string[]
  task?: { title?: string; due?: string; notes?: string }
  /** Only on handover: what the customer wants, for the team. */
  summary?: string
}

/** Gemini responseSchema of the `crm` output field. */
export const CRM_OUTPUT_SCHEMA = {
  type: 'OBJECT',
  description: 'What to register in the CRM this turn; only facts the customer stated. Omit or {} when nothing new.',
  properties: {
    contact: {
      type: 'OBJECT',
      properties: {
        name: { type: 'STRING' },
        email: { type: 'STRING' },
        phone: { type: 'STRING' },
        company: { type: 'STRING' },
        fields: {
          type: 'ARRAY',
          items: { type: 'OBJECT', properties: { field_id: { type: 'STRING' }, value: { type: 'STRING' } }, required: ['field_id', 'value'] },
        },
        extra_info: { type: 'STRING', description: 'Other useful facts the customer told, one short sentence' },
      },
    },
    deal_stage_id: { type: 'STRING', description: 'Stage id from the CRM PIPELINE list the customer now belongs in' },
    deal_title: { type: 'STRING', description: 'What the deal is about, 2-6 words' },
    deal_value: { type: 'NUMBER', description: 'Amount only when a concrete price was given' },
    tag_ids: { type: 'ARRAY', items: { type: 'STRING' } },
    task: {
      type: 'OBJECT',
      properties: {
        title: { type: 'STRING' },
        due: { type: 'STRING', description: 'YYYY-MM-DD HH:MM local time, or empty' },
        notes: { type: 'STRING' },
      },
    },
    summary: { type: 'STRING', description: 'Only when handover=true: 1-3 sentences on what the customer wants' },
  },
} as const

export interface CrmStage {
  id: string
  pipeline_id: string
  pipeline_name: string
  name: string
  position: number
  ai_hint: string | null
}

export interface CrmDeal {
  id: string
  pipeline_id: string
  stage_id: string
  title: string
  value: number
}

export interface CrmTag {
  id: string
  name: string
  ai_hint: string | null
}

export interface CrmContact {
  name: string | null
  email: string | null
  phone: string | null
  company: string | null
}

export interface CrmContext {
  /** Stages the AI may move deals to (those with a hint, outside real estate). */
  stages: CrmStage[]
  /** All stages of those pipelines, for forward-only checks. */
  allStages: { id: string; pipeline_id: string; position: number; name: string }[]
  deals: CrmDeal[]
  tags: CrmTag[]
  /** Contact tags already on the customer. */
  tagIds: string[]
  fields: (CustomField & { key: string | null })[]
  values: Record<string, string>
  contact: CrmContact
  /** Deals are managed by the lead logic (real estate). */
  dealsManaged: boolean
}

const clip = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '')
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const digits = (v: string) => v.replace(/\D/g, '')
const isPhoneLike = (v: string | null) => !!v && /^\+?[\d\s()-]+$/.test(v.trim())

/** CRM section of the system prompt (agents with crm_actions on). */
export function crmPromptSection(c: CrmContext, now: string): string {
  const lines: string[] = [
    'CRM (register what you learn; the system saves it and charges per action, so only set what is NEW and stated by the customer in this conversation — never guess):',
    `- On file: name=${c.contact.name || '—'}, email=${c.contact.email || '—'}, phone=${c.contact.phone || '—'}, company=${c.contact.company || '—'}`,
    '- crm.contact: name/email/phone/company the customer gives; crm.contact.fields as {field_id, value} for the custom fields below; crm.contact.extra_info for any other useful fact about the customer (one short sentence). If the customer gives a value different from the one on file, put it anyway: the system keeps both.',
  ]
  const own = c.fields.filter((f) => f.key !== EXTRA_INFO_KEY)
  if (own.length) {
    lines.push(
      '- Custom fields (id in brackets): ' +
        own
          .map((f) => {
            const opts = f.field_type === 'select' ? `: ${optionsOf(f).join('|')}` : f.field_type === 'date' ? ', YYYY-MM-DD' : f.field_type === 'boolean' ? ': true|false' : ''
            const cur = c.values[f.id]
            return `[${f.id}] ${f.field_name} (${f.field_type}${opts})${cur ? ` = ${cur.slice(0, 80)}` : ''}`
          })
          .join('; '),
    )
  }
  if (!c.dealsManaged && c.stages.length) {
    const stageName = (id: string) => c.allStages.find((s) => s.id === id)?.name
    lines.push(
      '- CRM PIPELINE: set crm.deal_stage_id when the conversation shows the customer now fits one of these stages (a deal is opened or moved forward; never backwards). Add crm.deal_title once (what they want). Stages:',
      ...c.stages.map((s) => `  [${s.id}] ${s.pipeline_name} › ${s.name}: ${s.ai_hint}`),
      c.deals.length
        ? `- Customer's open deals: ${c.deals.map((d) => `"${d.title}" at ${stageName(d.stage_id) ?? '—'}`).join('; ')}`
        : '- The customer has no open deal yet.',
    )
  }
  if (c.tags.length) {
    lines.push(
      '- Tags (crm.tag_ids, only when clearly true): ' +
        c.tags
          .filter((t) => !c.tagIds.includes(t.id))
          .map((t) => `[${t.id}] ${t.name}${t.ai_hint ? ` — ${t.ai_hint}` : ''}`)
          .join('; '),
    )
  }
  lines.push(
    `- crm.task: when the customer asks for something a person must do later (call back, send a quote, check stock…): title, due (YYYY-MM-DD HH:MM, now is ${now}) and notes.`,
    '- crm.summary: ONLY when handover=true, 1-3 sentences on what the customer wants and what is pending.',
  )
  return lines.join('\n')
}

export type CrmAction =
  | { kind: 'contact'; changed: string[] }
  | { kind: 'deal_created' | 'deal_moved'; stage: string; dealId?: string }
  | { kind: 'tag'; tag: string }
  | { kind: 'task'; title: string }
  | { kind: 'note' }

export interface ContactPlan {
  /** Columns to set on contacts (only empty ones). */
  patch: Partial<CrmContact>
  /** Custom field values to set (only empty ones), by field id. */
  fields: Record<string, string>
  /** Lines for "Más información del cliente": other facts and values that differ from the ones on file. */
  extra: string[]
  /** Labels of what changed, for the timeline. */
  changed: string[]
}

/**
 * What to write on the contact. Empty data is filled in; a value that
 * differs from the one on file never replaces it — it goes to "Más
 * información del cliente" with the extra facts. The chat's own number
 * (contacts.phone on WhatsApp) is never changed.
 */
export function planContact(out: CrmOutput['contact'], c: CrmContext, lang: 'es' | 'en'): ContactPlan {
  const plan: ContactPlan = { patch: {}, fields: {}, extra: [], changed: [] }
  if (!out || typeof out !== 'object') return plan
  const L = lang === 'en'
    ? { name: 'Name', email: 'Other email', phone: 'Other phone', company: 'Company' }
    : { name: 'Nombre', email: 'Otro correo', phone: 'Otro teléfono', company: 'Empresa' }

  const name = clip(out.name, 120)
  if (name && !isPhoneLike(name)) {
    if (!c.contact.name || isPhoneLike(c.contact.name)) {
      plan.patch.name = name
      plan.changed.push('name')
    } else if (name.toLowerCase() !== c.contact.name.toLowerCase() && !c.contact.name.toLowerCase().includes(name.toLowerCase())) {
      plan.extra.push(`${L.name}: ${name}`)
    }
  }
  const email = clip(out.email, 200).toLowerCase()
  if (email && EMAIL.test(email)) {
    if (!c.contact.email) {
      plan.patch.email = email
      plan.changed.push('email')
    } else if (email !== c.contact.email.toLowerCase()) plan.extra.push(`${L.email}: ${email}`)
  }
  const phone = clip(out.phone, 40)
  if (phone && digits(phone).length >= 6) {
    const p = `${phone.trim().startsWith('+') ? '+' : ''}${digits(phone)}`
    if (!c.contact.phone) {
      plan.patch.phone = p
      plan.changed.push('phone')
    } else if (!digits(c.contact.phone).endsWith(digits(phone)) && !digits(phone).endsWith(digits(c.contact.phone))) {
      plan.extra.push(`${L.phone}: ${p}`)
    }
  }
  const company = clip(out.company, 160)
  if (company) {
    if (!c.contact.company) {
      plan.patch.company = company
      plan.changed.push('company')
    } else if (company.toLowerCase() !== c.contact.company.toLowerCase()) plan.extra.push(`${L.company}: ${company}`)
  }
  for (const f of Array.isArray(out.fields) ? out.fields.slice(0, 20) : []) {
    const field = c.fields.find((x) => x.id === f?.field_id && x.key !== EXTRA_INFO_KEY)
    if (!field || typeof f.value !== 'string') continue
    const value = normalizeValue(field, f.value.slice(0, 1000))
    if (value === null) continue
    const cur = c.values[field.id]
    if (!cur) {
      plan.fields[field.id] = value
      plan.changed.push(field.field_name)
    } else if (cur.toLowerCase() !== value.toLowerCase()) plan.extra.push(`${field.field_name}: ${value}`)
  }
  const info = clip(out.extra_info, 300)
  if (info) plan.extra.push(info)
  return plan
}

/** Appends dated lines to the "Más información" text, skipping repeats and keeping it under the field limit. */
export function appendExtraInfo(current: string | null | undefined, lines: string[], date: string): string | null {
  const existing = (current ?? '').split('\n').map((l) => l.trim()).filter(Boolean)
  const known = new Set(existing.map((l) => l.replace(/^\d{4}-\d{2}-\d{2}:\s*/, '').toLowerCase()))
  const fresh = [...new Set(lines.map((l) => l.trim()).filter(Boolean))].filter((l) => !known.has(l.toLowerCase()))
  if (!fresh.length) return null
  const all = [...existing, ...fresh.map((l) => `${date}: ${l}`)]
  while (all.join('\n').length > EXTRA_INFO_MAX && all.length > 1) all.shift()
  return all.join('\n').slice(-EXTRA_INFO_MAX)
}

export type DealPlan =
  | { kind: 'none' }
  | { kind: 'create'; stage: CrmStage; title: string; value: number }
  | { kind: 'move'; stage: CrmStage; deal: CrmDeal; value: number | null }

/** Open a deal at the stage the AI chose, or move the customer's deal there — forward only. */
export function planDeal(out: CrmOutput, c: CrmContext): DealPlan {
  if (c.dealsManaged || !out.deal_stage_id) return { kind: 'none' }
  const stage = c.stages.find((s) => s.id === out.deal_stage_id)
  if (!stage) return { kind: 'none' }
  const value = typeof out.deal_value === 'number' && Number.isFinite(out.deal_value) && out.deal_value > 0 ? Math.round(out.deal_value * 100) / 100 : null
  const deal = c.deals.find((d) => d.pipeline_id === stage.pipeline_id)
  if (!deal) {
    const title = clip(out.deal_title, 120) || c.contact.name || c.contact.phone || stage.pipeline_name
    return { kind: 'create', stage, title, value: value ?? 0 }
  }
  const cur = c.allStages.find((s) => s.id === deal.stage_id)
  if (cur && cur.position >= stage.position) return { kind: 'none' }
  return { kind: 'move', stage, deal, value: deal.value === 0 ? value : null }
}

/** Tags to add: known ones, not on the customer yet, at most 5 per turn. */
export function planTags(out: CrmOutput, c: CrmContext): CrmTag[] {
  if (!Array.isArray(out.tag_ids)) return []
  return [...new Set(out.tag_ids)]
    .map((id) => c.tags.find((t) => t.id === id))
    .filter((t): t is CrmTag => !!t && !c.tagIds.includes(t.id))
    .slice(0, 5)
}

/** Task to create, with its due date as an ISO instant (local time → UTC via the offset). */
export function planTask(out: CrmOutput, toUtc: (localDate: string, localTime: string) => Date | null): { title: string; due: Date | null; notes: string | null } | null {
  const title = clip(out.task?.title, 200)
  if (!title) return null
  const m = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2}:\d{2}))?/.exec(clip(out.task?.due, 20))
  const due = m ? toUtc(m[1], m[2] ?? '09:00') : null
  return { title, due, notes: clip(out.task?.notes, 1000) || null }
}

/** Short text of the actions for the timeline ("guardó correo; negocio → Cotización; …"). */
export function describeActions(actions: CrmAction[], lang: 'es' | 'en'): string {
  const es = lang === 'es'
  return actions
    .map((a) => {
      switch (a.kind) {
        case 'contact':
          return `${es ? 'datos' : 'data'}: ${a.changed.join(', ')}`
        case 'deal_created':
          return `${es ? 'negocio nuevo en' : 'new deal in'} ${a.stage}`
        case 'deal_moved':
          return `${es ? 'negocio →' : 'deal →'} ${a.stage}`
        case 'tag':
          return `${es ? 'etiqueta' : 'tag'} ${a.tag}`
        case 'task':
          return `${es ? 'tarea' : 'task'} "${a.title}"`
        case 'note':
          return es ? 'nota resumen' : 'summary note'
      }
    })
    .join('; ')
}

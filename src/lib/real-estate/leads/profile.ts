// Pure helpers to clean and merge lead-profile data coming from the AI
// (or from the team's edits). Only non-empty values ever overwrite.

import {
  EMPTY_LEAD,
  FINANCING,
  LEAD_OPERATIONS,
  PURPOSES,
  type Financing,
  type LeadFields,
  type LeadOperation,
  type Purpose,
} from './types'

export const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()

const TYPE_SYNONYMS: [RegExp, string][] = [
  [/^(departamento|depa|dpto|dept|apartamento|apartment|flat|piso|condo|duplex|penthouse|loft|minidepartamento|mini departamento)s?$/, 'apartment'],
  [/^(casa|house|home|chalet|villa|casa de campo|townhouse)s?$/, 'house'],
  [/^(terreno|lote|land|lot|parcela|solar)s?$/, 'land'],
  [/^(oficina|office|consultorio)s?$/, 'office'],
  [/^(local|local comercial|commercial|retail|tienda|almacen|warehouse|deposito|nave)s?$/, 'commercial'],
]

/** "Depa", "departamentos", "apartment" → "apartment"; unknown values kept (normalized). */
export function normalizePropertyType(raw: string): string | null {
  const v = norm(raw)
  if (!v) return null
  for (const [re, out] of TYPE_SYNONYMS) if (re.test(v)) return out
  return v.slice(0, 40)
}

export function normalizeOperation(raw: unknown): LeadOperation | null {
  if (typeof raw !== 'string') return null
  const v = norm(raw)
  if ((LEAD_OPERATIONS as readonly string[]).includes(v)) return v as LeadOperation
  if (/^(compra|comprar|venta|sale|purchase|buying)$/.test(v)) return 'buy'
  if (/^(renta|rentar|alquiler|alquilar|arriendo|arrendar|rent|rental|lease)$/.test(v)) return 'rent'
  return null
}

export function normalizeCurrency(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const v = norm(raw)
  if (!v) return null
  if (/^(s\/\.?|sol|soles|pen|nuevos soles)$/.test(v)) return 'PEN'
  if (/^(\$|us\$|usd|dolar|dolares|dollar|dollars)$/.test(v)) return 'USD'
  if (/^(eur|euro|euros|€)$/.test(v)) return 'EUR'
  if (/^(mxn|pesos?)$/.test(v)) return 'MXN'
  const up = raw.trim().toUpperCase()
  return /^[A-Z]{3}$/.test(up) ? up : null
}

function cleanList(raw: unknown, map: (s: string) => string | null, max = 10): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const x of raw) {
    if (typeof x !== 'string') continue
    const v = map(x)
    if (v && !out.some((o) => norm(o) === norm(v))) out.push(v)
    if (out.length >= max) break
  }
  return out
}

const zoneName = (s: string) => {
  const v = s.replace(/\s+/g, ' ').trim().slice(0, 60)
  return v || null
}

function positiveNumber(raw: unknown, max = 1e12): number | null {
  const n = typeof raw === 'string' ? Number(raw.replace(/[^\d.]/g, '')) : typeof raw === 'number' ? raw : NaN
  return Number.isFinite(n) && n > 0 && n <= max ? Math.round(n * 100) / 100 : null
}

function smallInt(raw: unknown): number | null {
  const n = positiveNumber(raw, 50)
  return n === null ? null : Math.round(n)
}

/**
 * Models in plain JSON mode (no enforced schema) sometimes use near-miss
 * keys ("budget", "zone", "bedrooms"): map them to the real fields.
 */
const ALIASES: Record<string, keyof LeadFields> = {
  budget: 'budget_max',
  max_budget: 'budget_max',
  budget_maximum: 'budget_max',
  presupuesto: 'budget_max',
  min_budget: 'budget_min',
  zone: 'zones',
  zona: 'zones',
  zonas: 'zones',
  district: 'zones',
  districts: 'zones',
  property_type: 'property_types',
  type: 'property_types',
  bedrooms: 'bedrooms_min',
  bathrooms: 'bathrooms_min',
  parking: 'parking_min',
  move_in_date: 'move_in',
  timeframe: 'move_in',
}

function withAliases(r: Record<string, unknown>): Record<string, unknown> {
  const out = { ...r }
  for (const [alias, key] of Object.entries(ALIASES)) {
    if (!(alias in r) || (out[key] !== undefined && out[key] !== null && out[key] !== '')) continue
    const v = r[alias]
    out[key] = (key === 'zones' || key === 'property_types') && typeof v === 'string' ? v.split(/[,;]| y /).map((x) => x.trim()) : v
  }
  return out
}

/**
 * Validates a partial profile (AI output or API body). Unknown / empty /
 * invalid values are dropped, so the result only holds values worth
 * writing.
 */
export function sanitizeLeadPatch(raw: unknown): Partial<LeadFields> {
  if (!raw || typeof raw !== 'object') return {}
  const r = withAliases(raw as Record<string, unknown>)
  const out: Partial<LeadFields> = {}
  const op = normalizeOperation(r.operation)
  if (op) out.operation = op
  const types = cleanList(r.property_types, normalizePropertyType)
  if (types.length) out.property_types = types
  const zones = cleanList(r.zones, zoneName)
  if (zones.length) out.zones = zones
  const bmin = positiveNumber(r.budget_min)
  const bmax = positiveNumber(r.budget_max)
  if (bmin !== null) out.budget_min = bmin
  if (bmax !== null) out.budget_max = bmax
  if (out.budget_min != null && out.budget_max != null && out.budget_min > out.budget_max) {
    ;[out.budget_min, out.budget_max] = [out.budget_max, out.budget_min]
  }
  const cur = normalizeCurrency(r.currency)
  if (cur) out.currency = cur
  for (const k of ['bedrooms_min', 'bathrooms_min', 'parking_min'] as const) {
    const n = smallInt(r[k])
    if (n !== null) out[k] = n
  }
  if (typeof r.financing === 'string' && (FINANCING as readonly string[]).includes(r.financing) && r.financing !== 'unknown') {
    out.financing = r.financing as Financing
  }
  if (r.mortgage_preapproved === true) out.mortgage_preapproved = true
  if (typeof r.move_in === 'string' && r.move_in.trim()) out.move_in = r.move_in.trim().slice(0, 120)
  if (typeof r.purpose === 'string' && (PURPOSES as readonly string[]).includes(r.purpose) && r.purpose !== 'unknown') {
    out.purpose = r.purpose as Purpose
  }
  if (typeof r.notes === 'string' && r.notes.trim()) out.notes = r.notes.trim().slice(0, 2000)
  if (r.alerts_opt_in === true) out.alerts_opt_in = true
  return out
}

/** prev + patch (patch values win; nothing is ever cleared by the AI). */
export function mergeLead(prev: Partial<LeadFields> | null | undefined, patch: Partial<LeadFields>): LeadFields {
  const base: LeadFields = { ...EMPTY_LEAD, ...(prev ?? {}) }
  const next: LeadFields = { ...base, ...patch }
  if (patch.mortgage_preapproved) next.financing = next.financing === 'unknown' ? 'mortgage' : next.financing
  if (next.notes && base.notes && patch.notes && !base.notes.includes(patch.notes)) {
    next.notes = `${base.notes}\n${patch.notes}`.slice(-2000)
  }
  return next
}

/** Did this patch change anything? */
export function leadChanged(prev: Partial<LeadFields> | null | undefined, next: LeadFields): boolean {
  const base: LeadFields = { ...EMPTY_LEAD, ...(prev ?? {}) }
  return (Object.keys(next) as (keyof LeadFields)[]).some((k) => JSON.stringify(base[k]) !== JSON.stringify(next[k]))
}

/** Qualified = operation + at least one zone + a budget. */
export function isQualified(f: Partial<LeadFields>): boolean {
  return !!(f.operation && f.zones?.length && (f.budget_max || f.budget_min))
}

/** Product attribute value for a lead operation ("buy" → "sale"). */
export function listingOperation(op: LeadOperation | null | undefined): 'sale' | 'rent' | null {
  return op === 'buy' ? 'sale' : op === 'rent' ? 'rent' : null
}

/**
 * Team edit: keys present in the body are set; empty values (null, '',
 * []) clear the field. Invalid values are ignored.
 */
export function sanitizeUserLeadPatch(raw: unknown): Partial<LeadFields> {
  if (!raw || typeof raw !== 'object') return {}
  const r = raw as Record<string, unknown>
  const valid = sanitizeLeadPatch(r)
  const out: Partial<LeadFields> = {}
  const empty = (v: unknown) => v === null || v === '' || (Array.isArray(v) && v.length === 0)
  for (const key of Object.keys(EMPTY_LEAD) as (keyof LeadFields)[]) {
    if (!(key in r)) continue
    if (key in valid) (out as Record<string, unknown>)[key] = valid[key]
    else if (empty(r[key]) || r[key] === false) (out as Record<string, unknown>)[key] = EMPTY_LEAD[key]
    else if ((key === 'financing' || key === 'purpose') && r[key] === 'unknown') (out as Record<string, unknown>)[key] = 'unknown'
  }
  return out
}

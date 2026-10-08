// Routing-rule selection for qualified leads. Pure: unit-tested.

import { norm, normalizeOperation, normalizePropertyType } from './profile'
import type { LeadFields, RoutingConditions, RoutingRule } from './types'

/** Cleans a conditions object from the API (unknown keys dropped). */
export function sanitizeConditions(raw: unknown): RoutingConditions {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const list = (v: unknown, map: (s: string) => string | null) =>
    Array.isArray(v)
      ? [...new Set(v.filter((x): x is string => typeof x === 'string').map(map).filter((x): x is string => !!x))].slice(0, 30)
      : []
  const num = (v: unknown) => {
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN
    return Number.isFinite(n) && n >= 0 ? n : null
  }
  const out: RoutingConditions = {
    zones: list(r.zones, (s) => s.replace(/\s+/g, ' ').trim().slice(0, 60) || null),
    operation: normalizeOperation(r.operation),
    property_types: list(r.property_types, normalizePropertyType),
    budget_min: num(r.budget_min),
    budget_max: num(r.budget_max),
  }
  if (out.budget_min !== null && out.budget_max !== null && out.budget_min! > out.budget_max!) {
    ;[out.budget_min, out.budget_max] = [out.budget_max, out.budget_min]
  }
  return out
}

/**
 * Does the lead meet every condition of the rule? A condition the lead
 * has no data for does not match (empty conditions match every lead).
 */
export function ruleMatches(rule: Pick<RoutingRule, 'conditions'>, lead: Partial<LeadFields>): boolean {
  const c = rule.conditions ?? {}
  if (c.operation && lead.operation !== c.operation) return false
  if (c.zones?.length) {
    const want = c.zones.map(norm).filter(Boolean)
    const have = (lead.zones ?? []).map(norm)
    if (!have.some((z) => want.some((w) => z === w || z.includes(w) || w.includes(z)))) return false
  }
  if (c.property_types?.length) {
    const want = new Set(c.property_types.map((t) => normalizePropertyType(t)))
    if (!(lead.property_types ?? []).some((t) => want.has(normalizePropertyType(t)))) return false
  }
  if (c.budget_min != null || c.budget_max != null) {
    // The lead's budget range must overlap the rule's range.
    const lo = lead.budget_min ?? lead.budget_max
    const hi = lead.budget_max ?? lead.budget_min
    if (lo == null || hi == null) return false
    if (c.budget_min != null && hi < c.budget_min) return false
    if (c.budget_max != null && lo > c.budget_max) return false
  }
  return true
}

/** First active matching rule by priority (then creation order). */
export function selectRule<T extends RoutingRule>(rules: T[], lead: Partial<LeadFields>): T | null {
  const ordered = rules
    .filter((r) => r.active && (r.team_id || r.user_id))
    .sort((a, b) => a.priority - b.priority || String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')))
  return ordered.find((r) => ruleMatches(r, lead)) ?? null
}

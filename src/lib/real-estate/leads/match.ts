// Lead ↔ listing matching. Pure: unit-tested.
//
// A listing matches a lead when it is active and available and:
//   operation   lead buy → listing "sale", rent → "rent" (when both known)
//   zones       the listing's zone/district/address mentions one of the
//               lead's zones (or the other way round); required when the
//               lead has zones
//   budget      price within [budget_min − 10%, budget_max + 10%] (price
//               on request always passes; only compared when the lead's
//               currency equals the listing's effective currency — an
//               unknown lead currency counts as the workspace currency)
//   bedrooms    listing bedrooms ≥ bedrooms_min (unknown passes)
//   type        listing property_type in the lead's types (unknown passes)

import { listingOperation, norm, normalizePropertyType } from './profile'
import type { LeadFields, MatchProperty, PropertyMatch } from './types'

export const BUDGET_TOLERANCE = 0.1

/** Listing statuses that can still be offered. */
const OFFERABLE = new Set(['', 'available', 'active', 'disponible', 'published', 'publicada', 'new', 'nuevo'])

function attr(p: MatchProperty, key: string): unknown {
  return p.attributes?.[key]
}

function attrText(p: MatchProperty, key: string): string {
  const v = attr(p, key)
  if (Array.isArray(v)) return v.filter((x) => typeof x === 'string').join(' ')
  return typeof v === 'string' || typeof v === 'number' ? String(v) : ''
}

function attrNumber(p: MatchProperty, key: string): number | null {
  const v = attr(p, key)
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}

export function listingStatus(p: MatchProperty): string {
  return norm(String(p.listing_status ?? attrText(p, 'listing_status') ?? ''))
}

export function isOfferable(p: MatchProperty): boolean {
  return p.is_active && OFFERABLE.has(listingStatus(p))
}

const ZONE_KEYS = ['zone', 'district', 'distrito', 'neighborhood']

/** Zone-like values of the listing (zone, district, neighborhood), normalized. */
export function zoneParts(p: MatchProperty): string[] {
  return ZONE_KEYS.map((k) => norm(attrText(p, k))).filter(Boolean)
}

/**
 * A lead zone matches when it appears in the listing's zone/district or
 * address, or when the listing's zone appears in the lead zone ("Miraflores,
 * Lima" ⊇ "miraflores"). The city alone never matches (too broad).
 */
export function zonesOverlap(leadZones: string[], p: MatchProperty): boolean {
  const parts = zoneParts(p)
  const address = norm(attrText(p, 'address'))
  return leadZones.some((z) => {
    const n = norm(z)
    if (!n) return false
    return parts.some((part) => part.includes(n) || n.includes(part)) || (!!address && address.includes(n))
  })
}

export interface MatchOptions {
  /** Workspace currency: listings without their own currency are priced in it. */
  listingCurrency?: string | null
}

/** Effective currency of a listing: products.currency, a legacy attribute, else the workspace's. */
export function propertyCurrency(p: MatchProperty, workspaceCurrency?: string | null): string {
  const legacy = attr(p, 'currency')
  return (p.currency || (typeof legacy === 'string' ? legacy : '') || workspaceCurrency || '').toUpperCase()
}

/** Budget and price can be compared (same currency, or a side unknown). */
export function budgetComparable(lead: Partial<LeadFields>, p: MatchProperty, workspaceCurrency?: string | null): boolean {
  const leadCur = (lead.currency || workspaceCurrency || '').toUpperCase()
  const cur = propertyCurrency(p, workspaceCurrency)
  return !leadCur || !cur || leadCur === cur
}

/** Is `p` a fit for the lead? Returns a rank (higher is better) or null. */
export function matchProperty(lead: Partial<LeadFields>, p: MatchProperty, opts: MatchOptions = {}): number | null {
  if (!isOfferable(p)) return null
  let rank = 0

  const wantOp = listingOperation(lead.operation ?? null)
  const op = norm(attrText(p, 'operation'))
  if (wantOp && op) {
    const opNorm = /^(sale|venta|sell)$/.test(op) ? 'sale' : /^(rent|renta|alquiler|lease)$/.test(op) ? 'rent' : op
    if (opNorm !== wantOp) return null
    rank += 10
  }

  if (lead.zones?.length) {
    if (!zonesOverlap(lead.zones, p)) return null
    rank += 20
  }

  const comparable = budgetComparable(lead, p, opts.listingCurrency)
  if (p.price !== null && p.price !== undefined && comparable && (lead.budget_min || lead.budget_max)) {
    const price = Number(p.price)
    if (lead.budget_max && price > lead.budget_max * (1 + BUDGET_TOLERANCE)) return null
    if (lead.budget_min && price < lead.budget_min * (1 - BUDGET_TOLERANCE)) return null
    // Closer to the top of the budget ranks higher (usually the best fit).
    const target = lead.budget_max ?? lead.budget_min!
    rank += Math.max(0, 15 - Math.round((Math.abs(price - target) / target) * 50))
  }

  if (lead.bedrooms_min) {
    const beds = attrNumber(p, 'bedrooms')
    if (beds !== null) {
      if (beds < lead.bedrooms_min) return null
      rank += beds === lead.bedrooms_min ? 6 : 4
    }
  }
  if (lead.bathrooms_min) {
    const baths = attrNumber(p, 'bathrooms')
    if (baths !== null && baths < lead.bathrooms_min) return null
  }
  if (lead.parking_min) {
    const parking = attrNumber(p, 'parking')
    if (parking !== null && parking < lead.parking_min) return null
  }

  if (lead.property_types?.length) {
    const raw = attrText(p, 'property_type')
    const type = raw ? normalizePropertyType(raw) : null
    if (type) {
      if (!lead.property_types.some((t) => normalizePropertyType(t) === type)) return null
      rank += 8
    }
  }
  if (p.images?.length) rank += 2
  return rank
}

/** Best listings for a lead, best first. */
export function rankProperties(lead: Partial<LeadFields>, products: MatchProperty[], limit = 10, opts: MatchOptions = {}): PropertyMatch[] {
  const out: PropertyMatch[] = []
  for (const p of products) {
    const rank = matchProperty(lead, p, opts)
    if (rank !== null) out.push({ product: p, rank })
  }
  return out.sort((a, b) => b.rank - a.rank || (a.product.name < b.product.name ? -1 : 1)).slice(0, limit)
}

/** Leads (by index) a listing fits. */
export function leadsForProperty<T extends Partial<LeadFields>>(p: MatchProperty, leads: T[], opts: MatchOptions = {}): T[] {
  // A lead with no search criteria would match everything: skip it.
  return leads.filter((l) => !!(l.operation || l.zones?.length) && matchProperty(l, p, opts) !== null)
}

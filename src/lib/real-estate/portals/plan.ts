import type { AttributeField } from '@/lib/industries'
import { normalizeRow, type NormalizedRow, type RowError } from '@/lib/catalog/import'
import { fieldAccepts, listingCurrency, type PortalListing } from './values'

// Upsert planning by external id (pure): which listings create a
// product, which update the product already linked to the same
// (external_source, external_id), which fail validation and which
// existing products disappeared from the source.

export interface ExistingExternal {
  id: string
  externalId: string
  attributes: Record<string, unknown> | null
  images: string[]
  isActive: boolean
  missingSince: string | null
}

export interface PlannedListing extends NormalizedRow {
  externalId: string
  externalUrl: string | null
  action: 'create' | 'update' | 'error'
  productId?: string
  current?: ExistingExternal
  /** Priced in a currency other than the workspace's (stored in products.currency). */
  foreignCurrency: boolean
}

export interface ExternalPlan {
  rows: PlannedListing[]
  creates: number
  updates: number
  errors: number
  /** Products linked to this source that are no longer in it (and not yet marked). */
  missing: ExistingExternal[]
  foreignCurrency: number
}

export interface PlanOptions {
  fields: AttributeField[]
  workspaceCurrency: string
  /** Mark products absent from this import as missing (full snapshot sources). */
  deactivateMissing: boolean
}

export function planExternalImport(listings: PortalListing[], existing: ExistingExternal[], opts: PlanOptions): ExternalPlan {
  const byId = new Map(existing.map((e) => [e.externalId, e]))
  const seen = new Set<string>()
  const required = opts.fields.filter((f) => f.required)

  const rows: PlannedListing[] = listings.map((l, i) => {
    const n = normalizeRow(l.raw, opts.fields, i + 1)
    // The price keeps its own currency (e.g. a USD sale in a PEN workspace).
    const { currency, foreign } = listingCurrency(l.currency, opts.workspaceCurrency)
    if (currency !== undefined) n.data.currency = currency
    const errors: RowError[] = [...n.errors]
    const externalId = l.externalId.trim()
    if (!externalId) errors.push({ field: 'external_id', code: 'required' })
    else if (seen.has(externalId)) errors.push({ field: 'external_id', code: 'duplicate' })
    seen.add(externalId)
    const current = byId.get(externalId)
    if (!current) {
      for (const f of required) {
        if (n.data.attributes?.[f.key] === undefined && !errors.some((e) => e.field === `attr:${f.key}`)) {
          errors.push({ field: `attr:${f.key}`, code: 'required' })
        }
      }
      // New listings start as available when the field exists and the source said nothing.
      if (!errors.length && n.data.attributes?.listing_status === undefined && fieldAccepts(opts.fields, 'listing_status', 'available')) {
        n.data.attributes = { ...(n.data.attributes ?? {}), listing_status: 'available' }
      }
    }
    const base = { ...n, errors, externalId, externalUrl: l.externalUrl ?? null, foreignCurrency: foreign }
    if (errors.length) return { ...base, action: 'error' as const }
    return current ? { ...base, action: 'update' as const, productId: current.id, current } : { ...base, action: 'create' as const }
  })

  const present = new Set(listings.map((l) => l.externalId.trim()))
  const missing = opts.deactivateMissing ? existing.filter((e) => !present.has(e.externalId) && !e.missingSince) : []

  return {
    rows,
    creates: rows.filter((r) => r.action === 'create').length,
    updates: rows.filter((r) => r.action === 'update').length,
    errors: rows.filter((r) => r.action === 'error').length,
    missing,
    foreignCurrency: rows.filter((r) => r.foreignCurrency).length,
  }
}

/**
 * Columns that mark a product as gone from its source: hidden from the
 * AI (is_active=false) and, when the workspace's listing_status field
 * has an 'inactive' option, flagged as such. Never deleted.
 */
export function missingPatch(fields: AttributeField[], current: Record<string, unknown> | null, nowIso: string): Record<string, unknown> {
  const patch: Record<string, unknown> = { is_active: false, external_missing_since: nowIso }
  if (fieldAccepts(fields, 'listing_status', 'inactive')) patch.attributes = { ...(current ?? {}), listing_status: 'inactive' }
  return patch
}

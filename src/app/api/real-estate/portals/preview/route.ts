import { NextResponse } from 'next/server'
import { productAttributesFor } from '@/lib/catalog/attributes'
import { isUuid } from '@/lib/workspace/constants'
import { feedErrorCode, feedSource, fileSource, toListings } from '@/lib/real-estate/portals/feed/import'
import { guessFeedMapping, sanitizeMapping } from '@/lib/real-estate/portals/feed/mapping'
import { planExternalImport, type ExistingExternal } from '@/lib/real-estate/portals/plan'
import { requirePortalsAdmin } from '../_lib/guard'
import { parsedFromBody } from '../_lib/input'

export const maxDuration = 120

const clip = (v: string | string[]) => (Array.isArray(v) ? v.slice(0, 5).map((x) => x.slice(0, 200)) : v.slice(0, 300))

/**
 * POST /api/real-estate/portals/preview
 *   { url } | { text, format? } | { records }  + { item_path?, mapping?, feed_id? | label? }
 * → { format, item_path, fields, samples, total, mapping (given or suggested),
 *     plan: { creates, updates, errors, missing, foreign_currency, without_id, rows: [{row, ref, action, errors}] } }
 * Nothing is written.
 */
export async function POST(request: Request) {
  const guard = await requirePortalsAdmin()
  if (!guard.ok) return guard.response
  const ws = guard.ctx.workspace
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })

  let parsed
  try {
    parsed = await parsedFromBody(body)
  } catch (e) {
    return NextResponse.json({ error: feedErrorCode(e) }, { status: 422 })
  }

  const fields = productAttributesFor(ws.industry, ws.settings)
  const mapping = body.mapping && typeof body.mapping === 'object' ? sanitizeMapping(body.mapping, fields) : guessFeedMapping(parsed.fields, fields)

  const source = typeof body.feed_id === 'string' && isUuid(body.feed_id) ? feedSource(body.feed_id) : typeof body.label === 'string' && body.label.trim() ? fileSource(body.label) : null
  const existing: ExistingExternal[] = []
  if (source) {
    const data = await guard.ctx.db.products
      .findMany({
        select: { id: true, external_id: true, attributes: true, images: true, is_active: true, external_missing_since: true },
        where: { external_source: source },
        take: 5000,
      })
      .catch(() => null)
    for (const p of data ?? []) {
      existing.push({
        id: p.id,
        externalId: String(p.external_id),
        attributes: (p.attributes ?? {}) as Record<string, unknown>,
        images: p.images ?? [],
        isActive: !!p.is_active,
        missingSince: p.external_missing_since ?? null,
      })
    }
  }

  const { listings, withoutId } = toListings(parsed.records, mapping, fields)
  const plan = planExternalImport(listings, existing, {
    fields,
    workspaceCurrency: ws.currency || 'PEN',
    deactivateMissing: body.deactivate_missing !== false,
  })

  return NextResponse.json({
    format: parsed.format,
    item_path: parsed.itemPath,
    fields: parsed.fields,
    samples: parsed.records.slice(0, 5).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, clip(v)]))),
    total: parsed.records.length,
    mapping,
    plan: {
      creates: plan.creates,
      updates: plan.updates,
      errors: plan.errors,
      missing: plan.missing.length,
      foreign_currency: plan.foreignCurrency,
      without_id: withoutId,
      rows: plan.rows.slice(0, 200).map((r) => ({
        row: r.row,
        ref: r.externalId,
        name: r.data.name,
        price: r.data.price ?? null,
        currency: r.data.currency ?? null,
        action: r.action,
        errors: r.errors,
        attributes: r.data.attributes ?? {},
        images: r.data.images?.length ?? 0,
      })),
    },
  })
}

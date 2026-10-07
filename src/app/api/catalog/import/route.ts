import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { requireWorkspace } from '@/lib/workspace/context'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { invalidateBusinessContext } from '@/lib/ai/context'
import { productAttributesFor } from '@/lib/catalog/attributes'
import {
  IMPORT_BATCH,
  MAX_IMPORT_ROWS,
  categoryNames,
  normalizeRow,
  planUpsert,
  productPayload,
  type PlannedRow,
  type RawRecord,
} from '@/lib/catalog/import'

interface Failure {
  row: number
  error: string
}

/** Every product with a SKU in the workspace: sku → {id, attributes}. */
async function existingBySku(db: SupabaseClient, workspaceId: string) {
  const out = new Map<string, { id: string; attributes: Record<string, unknown> }>()
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from('products')
      .select('id, sku, attributes')
      .eq('workspace_id', workspaceId)
      .not('sku', 'is', null)
      .neq('sku', '')
      .order('id')
      .range(from, from + 999)
    if (error) throw new Error(error.message)
    for (const p of data ?? []) out.set(String(p.sku).trim().toLowerCase(), { id: p.id, attributes: p.attributes ?? {} })
    if (!data || data.length < 1000) break
  }
  return out
}

/** Category name (lowercase) → id, creating the missing ones. */
async function ensureCategories(db: SupabaseClient, workspaceId: string, names: string[]) {
  const map = new Map<string, string>()
  const load = async () => {
    const { data, error } = await db.from('product_categories').select('id, name').eq('workspace_id', workspaceId)
    if (error) throw new Error(error.message)
    for (const c of data ?? []) map.set(String(c.name).trim().toLowerCase(), c.id)
  }
  await load()
  const missing = names.filter((n) => !map.has(n.toLowerCase()))
  if (missing.length) {
    const { error } = await db
      .from('product_categories')
      .upsert(missing.map((name) => ({ workspace_id: workspaceId, name })), { onConflict: 'workspace_id,name', ignoreDuplicates: true })
    if (error) throw new Error(error.message)
    await load()
  }
  return map
}

const describe = (r: PlannedRow) => r.errors.map((e) => `${e.field}: ${e.code}`).join('; ')

/**
 * POST { rows: RawRecord & { row?: number }[] } (max 2,000) → { created, updated, failed: [{row, error}] }
 * Rows are re-validated here; a SKU that exists in the workspace updates
 * that product, anything else is created. Writes go in batches of 200.
 */
export async function POST(request: Request) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const { workspace: ws, user } = guard.ctx

  const body = (await request.json().catch(() => null)) as { rows?: unknown } | null
  const input = Array.isArray(body?.rows) ? (body.rows as (RawRecord & { row?: unknown })[]) : null
  if (!input || input.length === 0) return NextResponse.json({ error: 'rows is required' }, { status: 400 })
  if (input.length > MAX_IMPORT_ROWS) {
    return NextResponse.json({ error: `Too many rows (max ${MAX_IMPORT_ROWS})` }, { status: 400 })
  }

  const db = supabaseAdmin()
  const fields = productAttributesFor(ws.industry, ws.settings)
  const normalized = input.map((r, i) => {
    const n = Number(r?.row)
    return normalizeRow(r && typeof r === 'object' ? r : {}, fields, Number.isInteger(n) && n > 0 ? n : i + 1)
  })

  try {
    const existing = await existingBySku(db, ws.id)
    const plan = planUpsert(normalized, new Map([...existing].map(([sku, p]) => [sku, p.id])), fields)
    const failed: Failure[] = plan.rows.filter((r) => r.action === 'error').map((r) => ({ row: r.row, error: describe(r) }))
    const todo = plan.rows.filter((r) => r.action !== 'error')

    const categories = await ensureCategories(db, ws.id, categoryNames(todo.map((r) => r.data)))
    const categoryOf = (r: PlannedRow) => (r.data.category ? categories.get(r.data.category.trim().toLowerCase()) ?? null : undefined)

    // Creates: one insert per batch; on a batch error retry row by row to
    // pin the failure on the right rows.
    let created = 0
    const creates = todo.filter((r) => r.action === 'create')
    for (let i = 0; i < creates.length; i += IMPORT_BATCH) {
      const batch = creates.slice(i, i + IMPORT_BATCH)
      const payload = (r: PlannedRow) => ({ ...productPayload(r.data, categoryOf(r), 'create'), workspace_id: ws.id, created_by: user.id })
      const { data, error } = await db.from('products').insert(batch.map(payload)).select('id')
      if (!error) {
        created += data?.length ?? batch.length
        continue
      }
      for (const r of batch) {
        const { error: rowError } = await db.from('products').insert(payload(r))
        if (rowError) failed.push({ row: r.row, error: rowError.message })
        else created++
      }
    }

    // Updates: PostgREST has no multi-row update with different values,
    // so each batch runs its updates concurrently in small groups.
    let updated = 0
    const updates = todo.filter((r) => r.action === 'update')
    for (let i = 0; i < updates.length; i += IMPORT_BATCH) {
      const batch = updates.slice(i, i + IMPORT_BATCH)
      for (let j = 0; j < batch.length; j += 20) {
        const results = await Promise.all(
          batch.slice(j, j + 20).map(async (r) => {
            const current = existing.get(r.data.sku!.trim().toLowerCase())
            const { error } = await db
              .from('products')
              .update(productPayload(r.data, categoryOf(r), 'update', current?.attributes))
              .eq('workspace_id', ws.id)
              .eq('id', r.productId!)
            return { r, error }
          }),
        )
        for (const { r, error } of results) {
          if (error) failed.push({ row: r.row, error: error.message })
          else updated++
        }
      }
    }

    if (created + updated > 0) invalidateBusinessContext(ws.id)
    failed.sort((a, b) => a.row - b.row)
    return NextResponse.json({ created, updated, failed })
  } catch (err) {
    console.error('[catalog import]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Import failed' }, { status: 500 })
  }
}

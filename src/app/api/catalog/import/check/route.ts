import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { MAX_IMPORT_ROWS } from '@/lib/catalog/import'

/**
 * POST { skus: string[] } → { existing: { [sku]: productId } }
 * Which SKUs already exist in the workspace (case-insensitive), so the
 * import preview can tell creates from updates.
 */
export async function POST(request: Request) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const ws = guard.ctx.workspace

  const body = (await request.json().catch(() => null)) as { skus?: unknown } | null
  const wanted = new Set(
    (Array.isArray(body?.skus) ? body.skus : [])
      .slice(0, MAX_IMPORT_ROWS)
      .map((s) => String(s ?? '').trim().toLowerCase())
      .filter(Boolean),
  )
  const existing: Record<string, string> = {}
  if (wanted.size === 0) return NextResponse.json({ existing })

  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin()
      .from('products')
      .select('id, sku')
      .eq('workspace_id', ws.id)
      .not('sku', 'is', null)
      .neq('sku', '')
      .order('id')
      .range(from, from + 999)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    for (const p of data ?? []) {
      if (wanted.has(String(p.sku).trim().toLowerCase())) existing[p.sku] = p.id
    }
    if (!data || data.length < 1000) break
  }
  return NextResponse.json({ existing })
}

import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { MAX_IMPORT_ROWS } from '@/lib/catalog/import'

/**
 * POST { skus: string[] } → { existing: { [sku]: productId } }
 * Which SKUs already exist in the workspace (case-insensitive), so the
 * import preview can tell creates from updates.
 */
export async function POST(request: Request) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const { db } = guard.ctx

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
    let data: { id: string; sku: string | null }[]
    try {
      data = await db.products.findMany({
        select: { id: true, sku: true },
        where: { AND: [{ sku: { not: null } }, { sku: { not: '' } }] },
        orderBy: { id: 'asc' },
        skip: from,
        take: 1000,
      })
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
    }
    for (const p of data) {
      if (p.sku && wanted.has(String(p.sku).trim().toLowerCase())) existing[p.sku] = p.id
    }
    if (data.length < 1000) break
  }
  return NextResponse.json({ existing })
}

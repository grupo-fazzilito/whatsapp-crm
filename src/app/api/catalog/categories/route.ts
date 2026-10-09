import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'
import { isPrismaError } from '@/lib/db/errors'
import { listCategories } from '@/lib/catalog/manage'

/** GET /api/catalog/categories — any member. → { categories } with products: [{count}]. */
export async function GET() {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  try {
    return NextResponse.json({ categories: await listCategories(guard.ctx.db) })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}

/** POST /api/catalog/categories { name, sort_order? } — admins. → { category }; 409 duplicate. */
export async function POST(request: Request) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const { db, workspace } = guard.ctx
  const body = (await request.json().catch(() => null)) as { name?: unknown; sort_order?: unknown } | null
  const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 80) : ''
  if (!name) return NextResponse.json({ error: 'invalid' }, { status: 400 })
  const sortOrder = Number.isInteger(body?.sort_order) ? (body!.sort_order as number) : 0
  try {
    const category = await db.product_categories.create({ data: { workspace_id: workspace.id, name, sort_order: sortOrder } })
    return NextResponse.json({ category }, { status: 201 })
  } catch (err) {
    if (isPrismaError(err, 'P2002')) return NextResponse.json({ error: 'duplicate' }, { status: 409 })
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}

/** PATCH /api/catalog/categories { order: [{ id, sort_order }] } — admins (reorder). */
export async function PATCH(request: Request) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const { db } = guard.ctx
  const body = (await request.json().catch(() => null)) as { order?: unknown } | null
  const order = body?.order
  if (
    !Array.isArray(order) ||
    order.length > 500 ||
    !order.every((o) => {
      const e = o as { id?: unknown; sort_order?: unknown } | null
      return !!e && typeof e.id === 'string' && isUuid(e.id) && Number.isInteger(e.sort_order)
    })
  ) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 })
  }
  try {
    await Promise.all(
      (order as { id: string; sort_order: number }[]).map((o) => db.product_categories.updateMany({ where: { id: o.id }, data: { sort_order: o.sort_order } })),
    )
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}

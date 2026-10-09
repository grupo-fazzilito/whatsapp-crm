import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'
import { productAttributesFor } from '@/lib/catalog/attributes'
import { deleteProducts, listProducts, parseProduct, parseVariants, saveProduct, type ProductListFilters } from '@/lib/catalog/manage'

const MAX_IDS = 500

function idList(v: unknown): string[] | null {
  if (!Array.isArray(v) || v.length === 0 || v.length > MAX_IDS || !v.every((x) => typeof x === 'string' && isUuid(x))) return null
  return [...new Set(v as string[])]
}

/**
 * GET /api/catalog/products?page=&q=&category=&status=&featured=1&in_stock=1&attrs=<json> — any member.
 * → { products: Product[] (with product_variants: [{count}]), total }.
 * ?count_only=1 → { total } of the whole catalog.
 */
export async function GET(request: Request) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { db, workspace } = guard.ctx
  const sp = new URL(request.url).searchParams
  if (sp.get('count_only') === '1') return NextResponse.json({ total: await db.products.count() })

  let attrs: Record<string, string> = {}
  try {
    const parsed = JSON.parse(sp.get('attrs') || '{}') as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      attrs = Object.fromEntries(Object.entries(parsed).filter(([, v]) => typeof v === 'string')) as Record<string, string>
    }
  } catch {
    return NextResponse.json({ error: 'invalid_attrs' }, { status: 400 })
  }
  const status = sp.get('status')
  const filters: ProductListFilters = {
    page: Number(sp.get('page')) || 0,
    q: (sp.get('q') ?? '').slice(0, 200),
    category: sp.get('category') ?? '',
    status: status === 'active' || status === 'inactive' ? status : 'all',
    featured: sp.get('featured') === '1',
    inStock: sp.get('in_stock') === '1',
    attrs,
  }
  const fields = productAttributesFor(workspace.industry, workspace.settings)
  try {
    return NextResponse.json(await listProducts(db, workspace.id, filters, fields))
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}

/** POST /api/catalog/products { product, variants } — admins. → { id } */
export async function POST(request: Request) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const { db, workspace, user } = guard.ctx
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const product = parseProduct(body?.product)
  const variants = parseVariants(body?.variants)
  if (!product || !variants || variants.some((v) => v.id)) return NextResponse.json({ error: 'invalid' }, { status: 400 })
  const res = await saveProduct(db, workspace.id, user.id, null, product, variants)
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
  return NextResponse.json({ id: res.id }, { status: 201 })
}

/** PATCH /api/catalog/products { ids, patch: { is_active?, category_id? } } — admins (bulk). */
export async function PATCH(request: Request) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const { db } = guard.ctx
  const body = (await request.json().catch(() => null)) as { ids?: unknown; patch?: Record<string, unknown> } | null
  const ids = idList(body?.ids)
  const raw = body?.patch
  if (!ids || !raw || typeof raw !== 'object') return NextResponse.json({ error: 'invalid' }, { status: 400 })
  const data: { is_active?: boolean; category_id?: string | null } = {}
  if ('is_active' in raw) {
    if (typeof raw.is_active !== 'boolean') return NextResponse.json({ error: 'invalid' }, { status: 400 })
    data.is_active = raw.is_active
  }
  if ('category_id' in raw) {
    const c = raw.category_id
    if (c !== null && (typeof c !== 'string' || !isUuid(c))) return NextResponse.json({ error: 'invalid' }, { status: 400 })
    if (c && !(await db.product_categories.findFirst({ select: { id: true }, where: { id: c } }))) {
      return NextResponse.json({ error: 'invalid_category' }, { status: 400 })
    }
    data.category_id = c
  }
  if (!Object.keys(data).length) return NextResponse.json({ error: 'invalid' }, { status: 400 })
  const { count } = await db.products.updateMany({ where: { id: { in: ids } }, data })
  return NextResponse.json({ updated: count })
}

/** DELETE /api/catalog/products { ids } — admins. Also removes their catalog images. */
export async function DELETE(request: Request) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const { db, workspace } = guard.ctx
  const body = (await request.json().catch(() => null)) as { ids?: unknown } | null
  const ids = idList(body?.ids)
  if (!ids) return NextResponse.json({ error: 'invalid' }, { status: 400 })
  try {
    return NextResponse.json({ deleted: await deleteProducts(db, workspace.id, ids) })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}

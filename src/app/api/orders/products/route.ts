import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'

/**
 * GET /api/orders/products?q= — any member. Active products for a manual
 * order (name search, max 8), priced in the workspace currency, with
 * their variants: { products: [{ id, name, price, product_variants: [...] }] }.
 */
export async function GET(request: Request) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { db, workspace } = guard.ctx
  const q = (new URL(request.url).searchParams.get('q') ?? '').trim().slice(0, 100)
  const cur = workspace.currency
  try {
    const products = await db.products.findMany({
      select: { id: true, name: true, price: true, product_variants: { select: { id: true, name: true, price: true, is_active: true } } },
      where: {
        is_active: true,
        ...(q ? { name: { contains: q, mode: 'insensitive' as const } } : {}),
        // Orders are in the business currency: skip products priced in another one.
        ...(cur && /^[A-Z]{3}$/.test(cur) ? { OR: [{ currency: null }, { currency: cur }] } : {}),
      },
      orderBy: { name: 'asc' },
      take: 8,
    })
    return NextResponse.json({ products })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}

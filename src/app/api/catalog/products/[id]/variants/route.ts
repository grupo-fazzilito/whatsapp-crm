import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'

/** GET /api/catalog/products/[id]/variants — any member. → { variants } (sort_order, name). */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { id } = await ctx.params
  if (!isUuid(id)) return NextResponse.json({ variants: [] })
  const variants = await guard.ctx.db.product_variants.findMany({
    where: { product_id: id },
    orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
  })
  return NextResponse.json({ variants })
}

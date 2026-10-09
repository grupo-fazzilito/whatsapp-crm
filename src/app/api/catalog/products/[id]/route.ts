import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'
import { parseProduct, parseVariants, saveProduct } from '@/lib/catalog/manage'

/**
 * PATCH /api/catalog/products/[id] { product, variants, removed_variant_ids? } — admins.
 * Saves the product, syncs its variants and drops catalog images it no longer uses.
 */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const { db, workspace, user } = guard.ctx
  const { id } = await ctx.params
  if (!isUuid(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const product = parseProduct(body?.product)
  const variants = parseVariants(body?.variants)
  const removed = body?.removed_variant_ids ?? []
  if (!product || !variants || !Array.isArray(removed) || !removed.every((x) => typeof x === 'string' && isUuid(x))) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 })
  }
  const res = await saveProduct(db, workspace.id, user.id, id, product, variants, removed as string[])
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
  return NextResponse.json({ id: res.id })
}

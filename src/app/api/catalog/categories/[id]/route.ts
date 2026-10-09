import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'
import { isPrismaError } from '@/lib/db/errors'

/** PATCH /api/catalog/categories/[id] { name?, is_active? } — admins. 409 duplicate name. */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const { id } = await ctx.params
  if (!isUuid(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const body = (await request.json().catch(() => null)) as { name?: unknown; is_active?: unknown } | null
  const data: { name?: string; is_active?: boolean } = {}
  if (body?.name !== undefined) {
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : ''
    if (!name) return NextResponse.json({ error: 'invalid' }, { status: 400 })
    data.name = name
  }
  if (body?.is_active !== undefined) {
    if (typeof body.is_active !== 'boolean') return NextResponse.json({ error: 'invalid' }, { status: 400 })
    data.is_active = body.is_active
  }
  if (!Object.keys(data).length) return NextResponse.json({ error: 'invalid' }, { status: 400 })
  try {
    const { count } = await guard.ctx.db.product_categories.updateMany({ where: { id }, data })
    if (!count) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  } catch (err) {
    if (isPrismaError(err, 'P2002')) return NextResponse.json({ error: 'duplicate' }, { status: 409 })
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}

/** DELETE /api/catalog/categories/[id] — admins. Products keep existing, uncategorized. */
export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const { id } = await ctx.params
  if (!isUuid(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  try {
    const { count } = await guard.ctx.db.product_categories.deleteMany({ where: { id } })
    if (!count) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}

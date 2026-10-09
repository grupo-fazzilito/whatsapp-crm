import { NextResponse } from 'next/server'
import type { TenantDb } from '@/lib/db/tenant'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'
import { displayPhotoUrls, updateCapture, type PropertyCapture } from '@/lib/real-estate/captures'
import { propertyUrl } from '@/lib/real-estate/listing/url'

async function withExtras(c: PropertyCapture, slug: string, db: TenantDb) {
  const [photo_urls, contact, product] = await Promise.all([
    displayPhotoUrls(c.photos ?? []),
    c.contact_id ? db.contacts.findFirst({ select: { id: true, name: true, phone: true }, where: { id: c.contact_id } }) : null,
    c.product_id ? db.products.findFirst({ select: { id: true, name: true, is_active: true }, where: { id: c.product_id } }) : null,
  ])
  return {
    ...c,
    photo_urls,
    contact,
    product: product ? { ...product, public_url: product.is_active ? propertyUrl({ slug }, product) : null } : null,
  }
}

/** GET /api/captures/[id] — any member. Capture + signed photo URLs, contact and linked product. */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { db, workspace } = guard.ctx
  const { id } = await ctx.params
  if (!isUuid(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const data = await db.property_captures.findFirst({ where: { id } })
  if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ capture: await withExtras(data as unknown as PropertyCapture, workspace.slug, db) })
}

/** PATCH /api/captures/[id] — any member. Partial CaptureFields (status, assignee, notes, data, photos). */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { db, workspace } = guard.ctx
  const { id } = await ctx.params
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'invalid' }, { status: 400 })
  // Links and publication state are not editable here.
  for (const k of ['contact_id', 'conversation_id', 'product_id', 'source', 'published_at', 'workspace_id']) delete body[k]
  const res = await updateCapture(workspace.id, id, body)
  if (!res.ok) {
    const status = res.error === 'invalid' ? 400 : res.error === 'not_found' ? 404 : 500
    return NextResponse.json({ error: res.error, ...(res.errors ? { errors: res.errors } : {}) }, { status })
  }
  return NextResponse.json({ capture: await withExtras(res.capture, workspace.slug, db) })
}

/** DELETE /api/captures/[id] — admins. The published listing (if any) is kept. */
export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const { db } = guard.ctx
  const { id } = await ctx.params
  if (!isUuid(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  let deleted: number
  try {
    deleted = (await db.property_captures.deleteMany({ where: { id } })).count
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
  if (!deleted) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}

import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'
import { catalogStatus, connectCatalog, disconnectCatalog } from '@/lib/meta-catalog/connection'

/**
 * WhatsApp catalog (Meta Catalog API, synced in real time).
 * GET    → status (connection, WhatsApp numbers, queued changes, products Meta can't take)
 * POST   (admin) { channel_id, catalog_id } | { channel_id, create_name } → connect + send every product
 * DELETE (admin) → stop syncing, hide the storefront and cart
 */
export async function GET() {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  return NextResponse.json(await catalogStatus(guard.ctx.workspace))
}

export async function POST(request: Request) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const channelId = typeof body?.channel_id === 'string' && isUuid(body.channel_id) ? body.channel_id : null
  const catalogId = typeof body?.catalog_id === 'string' && /^\d{5,30}$/.test(body.catalog_id) ? body.catalog_id : null
  const createName = typeof body?.create_name === 'string' && body.create_name.trim() ? body.create_name.trim().slice(0, 100) : null
  if (!channelId || (!catalogId && !createName)) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  const r = await connectCatalog(guard.ctx.workspace.id, guard.ctx.user.id, { channelId, catalogId, createName })
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json(await catalogStatus(guard.ctx.workspace))
}

export async function DELETE() {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  await disconnectCatalog(guard.ctx.workspace.id)
  return NextResponse.json(await catalogStatus(guard.ctx.workspace))
}

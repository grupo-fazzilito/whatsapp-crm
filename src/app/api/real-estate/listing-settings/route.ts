import { NextResponse } from 'next/server'
import type { Prisma } from '@/generated/prisma/client'
import { requireWorkspace } from '@/lib/workspace/context'

/**
 * PATCH /api/real-estate/listing-settings { listing_noindex: boolean } — admins.
 * Merged into the latest workspaces.settings.real_estate (other keys kept).
 */
export async function PATCH(request: Request) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const { db, workspace } = guard.ctx
  const body = (await request.json().catch(() => null)) as { listing_noindex?: unknown } | null
  if (typeof body?.listing_noindex !== 'boolean') return NextResponse.json({ error: 'invalid' }, { status: 400 })
  try {
    const row = await db.workspaces.findFirst({ select: { settings: true }, where: { id: workspace.id } })
    if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    const prev = (row.settings && typeof row.settings === 'object' && !Array.isArray(row.settings) ? row.settings : {}) as Record<string, unknown>
    const re = prev.real_estate && typeof prev.real_estate === 'object' && !Array.isArray(prev.real_estate) ? (prev.real_estate as Record<string, unknown>) : {}
    const settings = { ...prev, real_estate: { ...re, listing_noindex: body.listing_noindex } }
    await db.workspaces.update({ where: { id: workspace.id }, data: { settings: settings as Prisma.InputJsonValue } })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}

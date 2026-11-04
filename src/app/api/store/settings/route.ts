import { NextResponse } from 'next/server'
import type { Prisma } from '@/generated/prisma/client'
import { requireWorkspace } from '@/lib/workspace/context'
import { missingForStore, storePath, storeSettings } from '@/lib/store/settings'
import { storeReadiness } from '@/lib/store/server'
import { siteUrl } from '@/lib/real-estate/listing/url'
import { tenantDb } from '@/lib/db/tenant'

/**
 * GET /api/store/settings → { settings, readiness, missing, missing_weight, url }
 * PUT /api/store/settings (admin) { ...settings } → same. Publishing
 *   (enabled: true) needs every readiness item: 400 not_ready otherwise.
 */
export async function GET() {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  return NextResponse.json(await payload(guard.ctx.workspace))
}

export async function PUT(request: Request) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const { workspace, db } = guard.ctx
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'invalid_body' }, { status: 400 })

  const current = storeSettings(workspace.settings?.store)
  const next = storeSettings({ ...current, ...body })
  if (next.enabled) {
    const missing = missingForStore(await storeReadiness({ ...workspace, settings: { ...workspace.settings, store: next } }))
    if (missing.length) return NextResponse.json({ error: 'not_ready', missing }, { status: 400 })
  }
  const settings = { ...(workspace.settings ?? {}), store: next }
  await db.workspaces.update({ where: { id: workspace.id }, data: { settings: settings as unknown as Prisma.InputJsonValue } })
  return NextResponse.json(await payload({ ...workspace, settings }))
}

async function payload(ws: Parameters<typeof storeReadiness>[0] & { slug: string }) {
  const [readiness, missingWeight] = await Promise.all([
    storeReadiness(ws),
    tenantDb(ws.id).products.count({ where: { is_active: true, weight_kg: null } }),
  ])
  return {
    missing_weight: missingWeight,
    settings: storeSettings(ws.settings?.store),
    readiness,
    missing: missingForStore(readiness),
    url: siteUrl() + storePath(ws.slug),
  }
}

import crypto from 'node:crypto'
import { NextResponse } from 'next/server'
import type { Prisma } from '@/generated/prisma/client'
import { requireWorkspace } from '@/lib/workspace/context'
import { feedPath, storeSettings } from '@/lib/store/settings'
import { siteUrl } from '@/lib/real-estate/listing/url'

/**
 * Product feed link for the WhatsApp catalog (Meta reads it on a schedule).
 * GET  → { url } (null when not created yet)
 * POST (admin) → creates it, or replaces it (the old link stops working) → { url }
 */
export async function GET() {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { workspace } = guard.ctx
  const token = storeSettings(workspace.settings?.store).feed_token
  return NextResponse.json({ url: token ? siteUrl() + feedPath(workspace.slug, token) : null })
}

export async function POST() {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const { workspace, db } = guard.ctx
  const token = crypto.randomBytes(24).toString('base64url')
  const store = { ...storeSettings(workspace.settings?.store), feed_token: token }
  const settings = { ...(workspace.settings ?? {}), store }
  await db.workspaces.update({ where: { id: workspace.id }, data: { settings: settings as unknown as Prisma.InputJsonValue } })
  return NextResponse.json({ url: siteUrl() + feedPath(workspace.slug, token) })
}

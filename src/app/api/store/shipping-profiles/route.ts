import { NextResponse } from 'next/server'
import type { Prisma } from '@/generated/prisma/client'
import { requireWorkspace } from '@/lib/workspace/context'
import { parseShippingInput, toShippingProfile } from '@/lib/store/shipping'

/**
 * GET  /api/store/shipping-profiles → { profiles }
 * POST /api/store/shipping-profiles (admin) { name, type, flat_price?, rates?, free_over?, eta?, is_active? } → { profile }
 */
export async function GET() {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const rows = await guard.ctx.db.shipping_profiles.findMany({ orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }] })
  return NextResponse.json({ profiles: rows.map(toShippingProfile) })
}

export async function POST(request: Request) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const { db, workspace } = guard.ctx
  const parsed = parseShippingInput(((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  if ((await db.shipping_profiles.count()) >= 30) return NextResponse.json({ error: 'too_many' }, { status: 400 })
  const row = await db.shipping_profiles.create({
    data: { ...parsed.profile, rates: parsed.profile.rates as unknown as Prisma.InputJsonValue, workspace_id: workspace.id },
  })
  return NextResponse.json({ profile: toShippingProfile(row) }, { status: 201 })
}

import { NextResponse } from 'next/server'
import type { Prisma } from '@/generated/prisma/client'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'
import { storeSettings } from '@/lib/store/settings'
import type { WorkspaceContext } from '@/lib/workspace/context'
import { parseShippingInput, toShippingProfile } from '@/lib/store/shipping'

type Ctx = { params: Promise<{ id: string }> }

/**
 * PATCH  /api/store/shipping-profiles/:id (admin) — the full profile, as in POST → { profile }
 * DELETE /api/store/shipping-profiles/:id (admin)
 * A published store must keep a way to receive orders: turning off or
 * deleting its last profile (without pickup) is refused with 'last_profile'.
 */
export async function PATCH(request: Request, { params }: Ctx) {
  const { id } = await params
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const { db } = guard.ctx
  if (!isUuid(id) || !(await db.shipping_profiles.findFirst({ where: { id }, select: { id: true } }))) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const parsed = parseShippingInput(((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  if (!parsed.profile.is_active && (await leavesStoreWithoutShipping(guard.ctx, id))) return NextResponse.json({ error: 'last_profile' }, { status: 400 })
  const row = await db.shipping_profiles.update({
    where: { id },
    data: { ...parsed.profile, rates: parsed.profile.rates as unknown as Prisma.InputJsonValue },
  })
  return NextResponse.json({ profile: toShippingProfile(row) })
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const { id } = await params
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  if (!isUuid(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (await leavesStoreWithoutShipping(guard.ctx, id)) return NextResponse.json({ error: 'last_profile' }, { status: 400 })
  await guard.ctx.db.shipping_profiles.deleteMany({ where: { id } })
  return NextResponse.json({ ok: true })
}

/** The store is published and this is its only way to deliver. */
async function leavesStoreWithoutShipping(ctx: WorkspaceContext, id: string) {
  const store = storeSettings(ctx.workspace.settings?.store)
  if (!store.enabled || store.pickup_enabled) return false
  const others = await ctx.db.shipping_profiles.count({ where: { is_active: true, id: { not: id } } })
  return others === 0
}

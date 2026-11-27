import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { onboardingState, parseOnboardingPatch } from '@/lib/workspace/onboarding'
import type { Prisma } from '@/generated/prisma/client'

/**
 * PATCH /api/business/onboarding { step? , status? } (admins) — progress of
 * the setup wizard: the step to resume at, or 'done' / 'skipped'.
 */
export async function PATCH(request: Request) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const patch = parseOnboardingPatch(await request.json().catch(() => null))
  if (!patch) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  const { db, workspace } = guard.ctx
  try {
    const row = await db.workspaces.findUniqueOrThrow({ where: { id: workspace.id }, select: { settings: true } })
    const settings = row.settings && typeof row.settings === 'object' && !Array.isArray(row.settings) ? (row.settings as Record<string, unknown>) : {}
    const onboarding = { ...onboardingState(settings), ...patch }
    await db.workspaces.update({
      where: { id: workspace.id },
      data: { settings: { ...settings, onboarding } as Prisma.InputJsonValue, updated_at: new Date() },
    })
    return NextResponse.json({ onboarding })
  } catch (err) {
    console.error('[onboarding] save failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'save_failed' }, { status: 500 })
  }
}

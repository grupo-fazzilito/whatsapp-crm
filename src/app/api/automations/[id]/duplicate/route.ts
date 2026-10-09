import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import type { Prisma } from '@/generated/prisma/client'

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const { user, workspace, db } = guard.ctx

  let original
  try {
    original = await db.automations.findFirst({ where: { id, workspace_id: workspace.id } })
  } catch (origErr) {
    return NextResponse.json({ error: errMessage(origErr) }, { status: 500 })
  }
  if (!original) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let copy
  try {
    copy = await db.automations.create({
      data: {
        workspace_id: workspace.id,
        user_id: user.id,
        name: `${original.name} (Copy)`,
        description: original.description,
        trigger_type: original.trigger_type,
        trigger_config: original.trigger_config as Prisma.InputJsonValue,
        is_active: false,
      },
    })
  } catch (copyErr) {
    return NextResponse.json({ error: errMessage(copyErr) || 'copy failed' }, { status: 500 })
  }

  const steps = await db.automation_steps
    .findMany({
      select: { id: true, parent_step_id: true, branch: true, step_type: true, step_config: true, position: true },
      where: { automation_id: id, workspace_id: workspace.id },
      orderBy: { position: 'asc' },
    })
    .catch(() => null)

  if (steps && steps.length > 0) {
    // Re-map parent_step_id: build old→new id map first so the second
    // pass inserts rows with correct parent references.
    const idMap = new Map<string, string>()
    const uid = () =>
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2) + Date.now().toString(36)
    for (const row of steps) idMap.set(row.id as string, uid())

    const rows = steps.map((row) => ({
      id: idMap.get(row.id as string)!,
      workspace_id: workspace.id,
      automation_id: copy.id,
      parent_step_id: row.parent_step_id ? idMap.get(row.parent_step_id as string) : null,
      branch: row.branch,
      step_type: row.step_type,
      step_config: row.step_config as Prisma.InputJsonValue,
      position: row.position,
    }))
    try {
      await db.automation_steps.createMany({ data: rows })
    } catch (insErr) {
      return NextResponse.json({ error: errMessage(insErr) }, { status: 500 })
    }
  }

  return NextResponse.json({ automation: copy }, { status: 201 })
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

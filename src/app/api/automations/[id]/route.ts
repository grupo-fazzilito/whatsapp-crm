import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import {
  loadStepsTree,
  replaceSteps,
  type BuilderStepInput,
} from '@/lib/automations/steps-tree'
import {
  partitionIssues,
  validateChannelRules,
  validateStepsForActivation,
  validateTriggerForActivation,
  type ChannelRef,
  type ValidationIssue,
} from '@/lib/automations/validate'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const guard = await requireWorkspace()
  if (!guard.ok) return guard.response
  const { workspace, db } = guard.ctx

  let automation
  try {
    automation = await db.automations.findFirst({ where: { id, workspace_id: workspace.id } })
  } catch (error) {
    return NextResponse.json({ error: errMessage(error) }, { status: 500 })
  }
  if (!automation) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const steps = await loadStepsTree(id, workspace.id)
  return NextResponse.json({ automation, steps })
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const { workspace, db } = guard.ctx

  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  // Ownership check before we touch anything. Load the fields we need
  // to compute the post-patch "effective" state for validation.
  const existing = await db.automations
    .findFirst({
      select: { id: true, is_active: true, trigger_type: true, trigger_config: true },
      where: { id, workspace_id: workspace.id },
    })
    .catch(() => null)
  if (!existing) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const update: Record<string, unknown> = {}
  for (const k of [
    'name',
    'description',
    'trigger_type',
    'trigger_config',
    'is_active',
  ] as const) {
    if (k in body) update[k] = body[k]
  }

  // If this PATCH leaves the automation active (either explicitly
  // activating it OR editing an already-active one), validate the
  // merged configuration first. Activation is the natural gate — drafts
  // are still allowed to be incomplete.
  let warnings: ValidationIssue[] = []
  const willBeActive =
    typeof update.is_active === 'boolean' ? update.is_active : existing.is_active
  if (willBeActive) {
    const mergedTriggerType = (update.trigger_type ?? existing.trigger_type) as string
    const mergedTriggerConfig = update.trigger_config ?? existing.trigger_config
    const mergedSteps = Array.isArray(body.steps)
      ? (body.steps as { step_type: string; step_config: Record<string, unknown> }[])
      : await loadStepsTree(id, workspace.id)
    const channels = await db.channels
      .findMany({ select: { id: true, type: true }, where: { workspace_id: workspace.id } })
      .catch(() => null)
    const { errors, warnings: w } = partitionIssues([
      ...validateTriggerForActivation(mergedTriggerType, mergedTriggerConfig),
      ...validateStepsForActivation(mergedSteps),
      ...validateChannelRules({
        triggerType: mergedTriggerType,
        triggerConfig: mergedTriggerConfig,
        steps: mergedSteps,
        channels: (channels ?? []) as ChannelRef[],
      }),
    ])
    if (errors.length > 0) {
      return NextResponse.json(
        {
          error: 'Cannot keep automation active with invalid configuration',
          issues: errors,
          warnings: w,
        },
        { status: 400 },
      )
    }
    warnings = w
  }

  if (Object.keys(update).length > 0) {
    try {
      await db.automations.updateMany({ where: { id, workspace_id: workspace.id }, data: update })
    } catch (updErr) {
      return NextResponse.json({ error: errMessage(updErr) }, { status: 500 })
    }
  }

  if (Array.isArray(body.steps)) {
    const err = await replaceSteps(id, workspace.id, body.steps as BuilderStepInput[])
    if (err) return NextResponse.json({ error: err }, { status: 500 })
  }

  return NextResponse.json({ ok: true, warnings })
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const { workspace, db } = guard.ctx

  try {
    await db.automations.deleteMany({ where: { id, workspace_id: workspace.id } })
  } catch (error) {
    return NextResponse.json({ error: errMessage(error) }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

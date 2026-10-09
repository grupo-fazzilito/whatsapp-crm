import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { getTemplate } from '@/lib/automations/templates'
import { insertSteps, type BuilderStepInput } from '@/lib/automations/steps-tree'
import {
  partitionIssues,
  validateChannelRules,
  validateStepsForActivation,
  validateTriggerForActivation,
  type ChannelRef,
  type ValidationIssue,
} from '@/lib/automations/validate'

export async function GET() {
  const guard = await requireWorkspace()
  if (!guard.ok) return guard.response
  const { db, workspace } = guard.ctx

  try {
    const data = await db.automations.findMany({
      where: { workspace_id: workspace.id },
      orderBy: { created_at: 'desc' },
    })
    return NextResponse.json({ automations: data })
  } catch (error) {
    return NextResponse.json({ error: errMessage(error) }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const { user, workspace, db } = guard.ctx

  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const { name, description, trigger_type, trigger_config, is_active, steps, template } = body

  let effectiveSteps: BuilderStepInput[] | undefined = steps
  let effectiveName = name
  let effectiveDescription = description
  let effectiveTriggerType = trigger_type
  let effectiveTriggerConfig = trigger_config

  if (template && (!steps || steps.length === 0)) {
    const t = getTemplate(template)
    if (t) {
      effectiveName = effectiveName ?? t.name
      effectiveDescription = effectiveDescription ?? t.description
      effectiveTriggerType = effectiveTriggerType ?? t.trigger_type
      effectiveTriggerConfig = effectiveTriggerConfig ?? t.trigger_config
      effectiveSteps = t.steps as unknown as BuilderStepInput[]
    }
  }

  if (!effectiveName || !effectiveTriggerType) {
    return NextResponse.json(
      { error: 'name and trigger_type are required' },
      { status: 400 },
    )
  }

  // Block activation of a clearly broken automation up-front instead of
  // letting every trigger silently produce a failed log row. Drafts
  // (is_active=false) are allowed to be incomplete so users can save
  // progress mid-build.
  let warnings: ValidationIssue[] = []
  if (is_active) {
    const stepsForCheck = (effectiveSteps ?? []) as unknown as { step_type: string; step_config: Record<string, unknown> }[]
    const channels = await db.channels
      .findMany({ select: { id: true, type: true }, where: { workspace_id: workspace.id } })
      .catch(() => null)
    const { errors, warnings: w } = partitionIssues([
      ...validateTriggerForActivation(effectiveTriggerType, effectiveTriggerConfig ?? {}),
      ...validateStepsForActivation(stepsForCheck),
      ...validateChannelRules({
        triggerType: effectiveTriggerType,
        triggerConfig: effectiveTriggerConfig ?? {},
        steps: stepsForCheck,
        channels: (channels ?? []) as ChannelRef[],
      }),
    ])
    if (errors.length > 0) {
      return NextResponse.json(
        { error: 'Cannot activate automation with invalid configuration', issues: errors, warnings: w },
        { status: 400 },
      )
    }
    warnings = w
  }

  let automation
  try {
    automation = await db.automations.create({
      data: {
        workspace_id: workspace.id,
        user_id: user.id,
        name: effectiveName,
        description: effectiveDescription ?? null,
        trigger_type: effectiveTriggerType,
        trigger_config: effectiveTriggerConfig ?? {},
        is_active: !!is_active,
      },
    })
  } catch (insertErr) {
    return NextResponse.json({ error: errMessage(insertErr) || 'insert failed' }, { status: 500 })
  }

  if (effectiveSteps && effectiveSteps.length > 0) {
    const err = await insertSteps(automation.id, workspace.id, effectiveSteps)
    if (err) return NextResponse.json({ error: err }, { status: 500 })
  }

  return NextResponse.json({ automation, warnings }, { status: 201 })
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { validateFlowForActivation } from '@/lib/flows/validate'

/**
 * POST /api/flows/[id]/activate
 *
 * Body: { status: 'draft' | 'active' | 'archived' }
 *
 * Activating runs the full validator and refuses on any 'error'
 * severity issue. Drafts and archives are unconditional — users
 * need to be able to save broken-work-in-progress and pause flows
 * without first fixing them.
 *
 * Returns the updated flow on success; on validation failure returns
 * the full issue list so the builder can highlight each problem.
 */

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params

  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const { db, workspace } = guard.ctx

  const body = (await request.json().catch(() => null)) as
    | { status?: 'draft' | 'active' | 'archived' }
    | null
  const status = body?.status
  if (!status || !['draft', 'active', 'archived'].includes(status)) {
    return NextResponse.json(
      { error: "status must be one of 'draft' | 'active' | 'archived'" },
      { status: 400 },
    )
  }

  // Ownership — tenant client, scoped to the active workspace.
  const existing = await db.flows
    .findFirst({ select: { id: true }, where: { id, workspace_id: workspace.id } })
    .catch(() => null)
  if (!existing) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  if (status === 'active') {
    // Re-load with the full payload the validator needs.
    const [flow, nodes, agents] = await Promise.all([
      db.flows
        .findFirst({
          select: { name: true, trigger_type: true, trigger_config: true, entry_node_id: true },
          where: { id, workspace_id: workspace.id },
        })
        .catch(() => null),
      db.flow_nodes
        .findMany({
          select: { node_key: true, node_type: true, config: true },
          where: { flow_id: id, workspace_id: workspace.id },
        })
        .catch(() => null),
      // handoff_ai_agent nodes must point at an enabled agent of this workspace.
      db.ai_agents
        .findMany({ select: { id: true }, where: { workspace_id: workspace.id, enabled: true } })
        .catch(() => null),
    ])
    if (!flow) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    const issues = validateFlowForActivation(
      flow as unknown as {
        name: string
        trigger_type: 'keyword' | 'first_inbound_message' | 'manual'
        trigger_config: Record<string, unknown>
        entry_node_id: string | null
      },
      (nodes ?? []) as unknown as Array<{
        node_key: string
        node_type: string
        config: Record<string, unknown>
      }>,
      { agentIds: (agents ?? []).map((a: { id: string }) => a.id) },
    )
    const blockers = issues.filter((i) => i.severity === 'error')
    if (blockers.length > 0) {
      return NextResponse.json(
        {
          error: 'Cannot activate flow — fix the issues below first.',
          issues,
        },
        { status: 422 },
      )
    }
  }

  let updated
  try {
    const rows = await db.flows.updateManyAndReturn({
      where: { id, workspace_id: workspace.id },
      data: { status, updated_at: new Date().toISOString() },
    })
    updated = rows[0] ?? null
  } catch (error) {
    return NextResponse.json({ error: errMessage(error) }, { status: 500 })
  }
  return NextResponse.json({ flow: updated })
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import type { Prisma } from '@/generated/prisma/client'
import type { TenantDb } from '@/lib/db/tenant'

/**
 * GET   /api/flows/[id]  — fetch one flow with its nodes.
 * PUT   /api/flows/[id]  — replace name/trigger/entry/fallback + the
 *                          full node graph (delete-then-insert under
 *                          the hood; not atomic, but the runner is
 *                          resilient to mid-edit reads — node_not_found
 *                          gracefully ends the run).
 * DELETE /api/flows/[id] — hard delete (RLS+CASCADE clean up nodes,
 *                          runs, events).
 *
 * All three require a member of the flow's workspace (PUT/DELETE need
 * the admin role). Flows is in
 * soft-GA — the beta gate that previously 404'd non-beta accounts is
 * gone; the "Beta" label in the UI is the only remaining signal.
 */

async function requireOwnership(
  flowId: string,
  minRole: 'agent' | 'admin' = 'agent',
): Promise<
  | {
      ok: true
      workspaceId: string
      db: TenantDb
    }
  | { ok: false; response: NextResponse }
> {
  const guard = await requireWorkspace(minRole)
  if (!guard.ok) return guard
  const { db, workspace } = guard.ctx
  // Scoped to the active workspace — a flow from another workspace
  // returns null (404 below).
  const flow = await db.flows
    .findFirst({ select: { id: true }, where: { id: flowId, workspace_id: workspace.id } })
    .catch(() => null)
  if (!flow) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Not found' }, { status: 404 }),
    }
  }
  return { ok: true, workspaceId: workspace.id, db }
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  const guard = await requireOwnership(id)
  if (!guard.ok) return guard.response
  const { db } = guard

  const [flow, nodes] = await Promise.all([
    db.flows.findFirst({ where: { id } }).catch(() => null),
    db.flow_nodes
      .findMany({ where: { flow_id: id }, orderBy: { created_at: 'asc' } })
      .catch(() => null),
  ])
  if (!flow) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  return NextResponse.json({ flow, nodes: nodes ?? [] })
}

interface PutBody {
  name?: string
  description?: string | null
  trigger_type?: 'keyword' | 'first_inbound_message' | 'manual'
  trigger_config?: Record<string, unknown>
  entry_node_id?: string | null
  fallback_policy?: Record<string, unknown>
  nodes?: Array<{
    node_key: string
    node_type: string
    config: Record<string, unknown>
    position_x?: number
    position_y?: number
  }>
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  const guard = await requireOwnership(id, 'admin')
  if (!guard.ok) return guard.response
  const { workspaceId, db } = guard

  const body = (await request.json().catch(() => null)) as PutBody | null
  if (!body) {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (body.name !== undefined && !body.name.trim()) {
    return NextResponse.json(
      { error: 'name cannot be empty' },
      { status: 400 },
    )
  }

  // Update the flow row first — the body may not include `nodes` (a
  // header-only save for editing the trigger config without touching
  // the graph). Skip node replacement in that case.
  const flowPatch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  }
  if (body.name !== undefined) flowPatch.name = body.name.trim()
  if (body.description !== undefined)
    flowPatch.description = body.description
  if (body.trigger_type !== undefined) flowPatch.trigger_type = body.trigger_type
  if (body.trigger_config !== undefined)
    flowPatch.trigger_config = body.trigger_config
  if (body.entry_node_id !== undefined)
    flowPatch.entry_node_id = body.entry_node_id
  if (body.fallback_policy !== undefined)
    flowPatch.fallback_policy = body.fallback_policy

  try {
    await db.flows.updateMany({ where: { id, workspace_id: workspaceId }, data: flowPatch })
  } catch (updErr) {
    return NextResponse.json({ error: errMessage(updErr) }, { status: 500 })
  }

  if (body.nodes !== undefined) {
    // Delete-then-insert. Not transactional but the runner handles
    // mid-edit reads safely (a node_not_found ends the run cleanly).
    try {
      await db.flow_nodes.deleteMany({ where: { flow_id: id, workspace_id: workspaceId } })
    } catch (delErr) {
      return NextResponse.json({ error: errMessage(delErr) }, { status: 500 })
    }
    if (body.nodes.length > 0) {
      try {
        await db.flow_nodes.createMany({
          data: body.nodes.map((n) => ({
            workspace_id: workspaceId,
            flow_id: id,
            node_key: n.node_key,
            node_type: n.node_type,
            config: n.config as Prisma.InputJsonValue,
            position_x: n.position_x ?? 0,
            position_y: n.position_y ?? 0,
          })),
        })
      } catch (insErr) {
        return NextResponse.json({ error: errMessage(insErr) }, { status: 500 })
      }
    }
  }

  // Re-fetch and return the new state — the editor uses the response
  // to reconcile its local form state.
  const [flow, nodes] = await Promise.all([
    db.flows.findFirst({ where: { id, workspace_id: workspaceId } }).catch(() => null),
    db.flow_nodes
      .findMany({ where: { flow_id: id, workspace_id: workspaceId }, orderBy: { created_at: 'asc' } })
      .catch(() => null),
  ])
  return NextResponse.json({ flow, nodes: nodes ?? [] })
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  const guard = await requireOwnership(id, 'admin')
  if (!guard.ok) return guard.response

  // CASCADE on flow_nodes / flow_runs / flow_run_events handles the
  // children. Active runs end abruptly — there's no graceful "drain"
  // mechanism in v1, but that's intentional: deleting a flow is a
  // deliberate destructive action and the partial unique index will
  // free up the contact for new triggers immediately.
  try {
    await guard.db.flows.deleteMany({ where: { id, workspace_id: guard.workspaceId } })
  } catch (error) {
    return NextResponse.json({ error: errMessage(error) }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}


function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

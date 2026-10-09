import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import type { Prisma } from '@/generated/prisma/client'
import { getFlowTemplate } from '@/lib/flows/templates'

/**
 * GET /api/flows — list the caller's flows.
 * POST /api/flows — create a new (draft) flow.
 *
 * Reads need workspace membership; creating needs the admin role. The previous per-account
 * beta gate was removed when Flows went to soft-GA; the UI still
 * shows a "Beta" label so users know the surface is young, but the
 * routes themselves are open.
 */

export async function GET() {
  const guard = await requireWorkspace()
  if (!guard.ok) return guard.response
  const { db, workspace } = guard.ctx

  try {
    const data = await db.flows.findMany({
      where: { workspace_id: workspace.id },
      orderBy: { created_at: 'desc' },
    })
    return NextResponse.json({ flows: data })
  } catch (error) {
    return NextResponse.json({ error: errMessage(error) }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const { user, workspace, db } = guard.ctx
  const userId = user.id
  const workspaceId = workspace.id

  const body = (await request.json().catch(() => null)) as
    | {
        name?: string
        description?: string | null
        trigger_type?: 'keyword' | 'first_inbound_message' | 'manual'
        trigger_config?: Record<string, unknown>
        /**
         * If set, clone the matching template's name + trigger +
         * entry_node_id + nodes[] into a fresh draft for this workspace.
         * `name` from the body overrides the template default if
         * provided.
         */
        template_slug?: string
        /**
         * If set, duplicate an existing flow (in the same workspace)
         * including all its nodes. Creates a new draft copy.
         */
        duplicate_from?: string
      }
    | null
  if (!body) {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // -------- Template clone path --------
  if (body.template_slug) {
    const template = getFlowTemplate(body.template_slug)
    if (!template) {
      return NextResponse.json(
        { error: `Unknown template_slug "${body.template_slug}"` },
        { status: 400 },
      )
    }
    let flow
    try {
      flow = await db.flows.create({
        data: {
          workspace_id: workspaceId,
          user_id: userId,
          name: body.name?.trim() || template.name,
          description: template.description,
          status: 'draft',
          trigger_type: template.trigger_type,
          trigger_config: template.trigger_config as Prisma.InputJsonValue,
          entry_node_id: template.entry_node_id,
        },
      })
    } catch (flowErr) {
      return NextResponse.json(
        { error: errMessage(flowErr) || 'flow insert failed' },
        { status: 500 },
      )
    }
    if (template.nodes.length > 0) {
      try {
        await db.flow_nodes.createMany({
          data: template.nodes.map((n) => ({
            workspace_id: workspaceId,
            flow_id: flow.id,
            node_key: n.node_key,
            node_type: n.node_type,
            config: n.config as Prisma.InputJsonValue,
          })),
        })
      } catch (nodesErr) {
        // Roll back the parent flow so a half-cloned template doesn't
        // sit as an empty draft. CASCADE on flow_id removes the
        // (probably zero) nodes too.
        await db.flows
          .deleteMany({ where: { id: flow.id, workspace_id: workspaceId } })
          .catch(() => null)
        return NextResponse.json(
          { error: errMessage(nodesErr) },
          { status: 500 },
        )
      }
    }
    return NextResponse.json({ flow }, { status: 201 })
  }

  // -------- Duplicate existing flow path --------
  if (body.duplicate_from) {
    const src = await db.flows
      .findFirst({ where: { id: body.duplicate_from, workspace_id: workspaceId } })
      .catch(() => null)
    if (!src) {
      return NextResponse.json(
        { error: 'Source flow not found or not owned by you' },
        { status: 404 },
      )
    }
    let flow
    try {
      flow = await db.flows.create({
        data: {
          workspace_id: workspaceId,
          user_id: userId,
          name: body.name?.trim() || `${src.name} (copy)`,
          description: src.description,
          status: 'draft',
          trigger_type: body.trigger_type ?? src.trigger_type,
          trigger_config: (body.trigger_config ?? src.trigger_config) as Prisma.InputJsonValue,
          entry_node_id: src.entry_node_id,
        },
      })
    } catch (flowErr) {
      return NextResponse.json(
        { error: errMessage(flowErr) || 'flow insert failed' },
        { status: 500 },
      )
    }
    // Copy nodes from source flow
    const srcNodes = await db.flow_nodes
      .findMany({
        select: { node_key: true, node_type: true, config: true },
        where: { flow_id: body.duplicate_from, workspace_id: workspaceId },
      })
      .catch(() => null)
    if (srcNodes && srcNodes.length > 0) {
      try {
        await db.flow_nodes.createMany({
          data: srcNodes.map((n) => ({
            workspace_id: workspaceId,
            flow_id: flow.id,
            node_key: n.node_key,
            node_type: n.node_type,
            config: n.config as Prisma.InputJsonValue,
          })),
        })
      } catch (nodesErr) {
        await db.flows
          .deleteMany({ where: { id: flow.id, workspace_id: workspaceId } })
          .catch(() => null)
        return NextResponse.json(
          { error: errMessage(nodesErr) },
          { status: 500 },
        )
      }
    }
    return NextResponse.json({ flow }, { status: 201 })
  }

  // -------- Plain (empty) create path --------
  if (!body.name?.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }
  const trigger_type = body.trigger_type ?? 'keyword'

  let data
  try {
    data = await db.flows.create({
      data: {
        workspace_id: workspaceId,
        user_id: userId,
        name: body.name.trim(),
        description: body.description ?? null,
        status: 'draft',
        trigger_type,
        trigger_config: (body.trigger_config ?? {}) as Prisma.InputJsonValue,
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: errMessage(error) || 'insert failed' },
      { status: 500 },
    )
  }
  return NextResponse.json({ flow: data }, { status: 201 })
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

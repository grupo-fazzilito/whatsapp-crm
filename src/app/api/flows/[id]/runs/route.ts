import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'

/**
 * GET /api/flows/[id]/runs
 *
 * Newest-first list of flow runs for a single flow, with the latest
 * event timeline embedded for each. Used by the run-history viewer
 * page (`/flows/[id]/runs`) to give the owner end-to-end visibility
 * into what the bot did with each customer.
 *
 * The workspace-scoped client does the access check (flow_runs is
 * confined to the active workspace); we also filter by workspace_id.
 *
 * Limited to the 50 most recent runs. Pagination can come later;
 * the dashboard surface here is for debugging, not heavy querying.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params

  const guard = await requireWorkspace()
  if (!guard.ok) return guard.response
  const { db, workspace } = guard.ctx

  // Confirm flow exists + caller owns it before doing the run query —
  // gives us a clean 404 instead of empty array.
  const flow = isUuid(id)
    ? await db.flows.findFirst({ select: { id: true, name: true }, where: { id, workspace_id: workspace.id } })
    : null
  if (!flow) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Pull runs + each run's contact name + each run's events. Two
  // joined selects keep the round-trip count to the runs query + one
  // per-run events query.
  let runs
  try {
    const rows = await db.flow_runs.findMany({
      select: {
        id: true,
        status: true,
        current_node_key: true,
        started_at: true,
        last_advanced_at: true,
        ended_at: true,
        end_reason: true,
        vars: true,
        reprompt_count: true,
        contacts: { select: { id: true, name: true, phone: true } },
      },
      where: { flow_id: id, workspace_id: workspace.id },
      orderBy: { started_at: 'desc' },
      take: 50,
    })
    runs = rows.map(({ contacts, ...r }) => ({ ...r, contact: contacts ?? null }))
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to load runs' }, { status: 500 })
  }

  const runIds = runs.map((r) => r.id)
  let events: Array<{
    flow_run_id: string
    event_type: string
    node_key: string | null
    payload: Record<string, unknown>
    created_at: string
  }> = []
  if (runIds.length > 0) {
    try {
      const evs = await db.flow_run_events.findMany({
        select: { flow_run_id: true, event_type: true, node_key: true, payload: true, created_at: true },
        where: { flow_run_id: { in: runIds }, workspace_id: workspace.id },
        orderBy: { created_at: 'asc' },
      })
      events = evs as unknown as typeof events
    } catch (err) {
      // Non-fatal — the page can still show runs without timelines.
      console.error('[flows-runs] events fetch failed:', err instanceof Error ? err.message : err)
    }
  }

  return NextResponse.json({
    flow,
    runs,
    events,
  })
}

import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { tenantDb } from '@/lib/db/tenant'
import { resolveFallbackPolicy } from '@/lib/flows/fallback'

/**
 * Sweep abandoned active flow runs.
 *
 * Reads each active run's parent-flow `fallback_policy.on_timeout_hours`
 * to compute the staleness cutoff (default 24h), then marks any run
 * past its cutoff as `timed_out`. Writes a matching `flow_run_events`
 * row for the audit trail.
 *
 * Without this sweep, a customer who abandons a flow mid-conversation
 * keeps a row in `idx_one_active_run_per_contact` (the partial unique
 * index on `flow_runs WHERE status='active'`) forever — blocking any
 * new triggers for them. The cron is therefore not optional.
 *
 * Auth: re-uses `AUTOMATION_CRON_SECRET` so operators only have one
 * secret to provision. The two endpoints (`/api/automations/cron`
 * and this one) are independent operations; we keep them on separate
 * URLs so one failing doesn't block the other.
 *
 * Hosting: hit on a schedule (Vercel Cron / GitHub Actions / external
 * pinger). A 5-minute interval is more than enough for a 24h timeout
 * default; once per hour would also be acceptable for low-volume
 * tenants.
 */
export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }
  // Constant-time compare so an attacker who can hit the endpoint
  // can't recover the secret byte-by-byte from response-time deltas.
  // Length pre-check is required by timingSafeEqual (throws otherwise)
  // and leaks only the length itself, which isn't sensitive.
  const supplied = request.headers.get('x-cron-secret') ?? ''
  const suppliedBuf = Buffer.from(supplied)
  const expectedBuf = Buffer.from(expected)
  if (
    suppliedBuf.length !== expectedBuf.length ||
    !timingSafeEqual(suppliedBuf, expectedBuf)
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date()

  // Pull all currently-active runs along with their parent flow's
  // fallback_policy. Joined in one query — the small set of active
  // runs per tenant keeps this cheap.
  // Platform task: scans the active runs of every workspace.
  let runs
  try {
    runs = await prisma.flow_runs.findMany({
      select: {
        id: true,
        flow_id: true,
        workspace_id: true,
        contact_id: true,
        last_advanced_at: true,
        flows: { select: { fallback_policy: true } },
      },
      where: { status: 'active' },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[flows-cron] active-run scan failed:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
  if (!runs.length) return NextResponse.json({ swept: 0 })

  type Row = {
    id: string
    flow_id: string
    workspace_id: string
    contact_id: string | null
    last_advanced_at: string
    flows: { fallback_policy: unknown } | { fallback_policy: unknown }[] | null
  }

  let swept = 0
  for (const r of runs as unknown as Row[]) {
    const flowsField = Array.isArray(r.flows) ? r.flows[0] : r.flows
    const policy = resolveFallbackPolicy(flowsField?.fallback_policy ?? null)
    const lastAdvanced = new Date(r.last_advanced_at)
    const ageHours = (now.getTime() - lastAdvanced.getTime()) / (1000 * 60 * 60)
    if (ageHours < policy.on_timeout_hours) continue

    // Mark timed_out — guarded by the precondition `status='active'`
    // so concurrent advance from a late inbound doesn't overwrite a
    // legitimate update.
    const db = tenantDb(r.workspace_id)
    const updated = await db.flow_runs
      .updateMany({
        where: { id: r.id, workspace_id: r.workspace_id, status: 'active' },
        data: {
          status: 'timed_out',
          ended_at: now.toISOString(),
          end_reason: 'stale_sweep',
        },
      })
      .catch(() => null)

    if (updated && updated.count > 0) {
      await db.flow_run_events
        .create({
          data: {
            workspace_id: r.workspace_id,
            flow_run_id: r.id,
            event_type: 'timeout',
            payload: {
              age_hours: Math.round(ageHours * 10) / 10,
              policy_hours: policy.on_timeout_hours,
            },
          },
        })
        .catch((err) => console.error('[flows-cron] timeout event insert failed:', err))
      swept += 1
    }
  }

  return NextResponse.json({ swept })
}

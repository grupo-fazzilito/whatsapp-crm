import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { resumePendingExecution } from '@/lib/automations/engine'
import type { AutomationContext } from '@/lib/automations/engine'
import { processDueFollowups } from '@/lib/automations/followups'
import { remindAbandonedCarts } from '@/lib/orders/abandoned'
import { remindDueTasks } from '@/lib/crm/reminders'
import { processPropertyMatchJobs } from '@/lib/real-estate/leads/alerts'
import { processViewings } from '@/lib/real-estate/leads/visits'
import { runGoogleCalendarCron } from '@/lib/integrations/google/sync'
import { runScheduledPortalImports } from '@/lib/real-estate/portals/schedule'
import { processWebhookDeliveries } from '@/lib/webhooks/deliver'
import { runBillingCron } from '@/lib/billing/payments'

/**
 * Drain due `automation_pending_executions` rows, then fire due
 * follow-up schedules (no_reply trigger, `followup_schedules`). Meant to be hit
 * on a schedule (Vercel Cron / external pinger) — requires a shared
 * secret via the `x-cron-secret` header to match
 * `AUTOMATION_CRON_SECRET`.
 *
 * The claim step (status = 'running') serves as a simple lock so
 * overlapping invocations don't double-process rows. Best-effort
 * only; expensive SELECT ... FOR UPDATE is avoided in favor of a
 * two-step UPDATE-by-id.
 */
export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }
  const supplied = request.headers.get('x-cron-secret')
  if (supplied !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = supabaseAdmin()
  const { data: due, error } = await admin
    .from('automation_pending_executions')
    .select('*')
    .eq('status', 'pending')
    .lte('run_at', new Date().toISOString())
    .order('run_at', { ascending: true })
    .limit(50)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  let processed = 0
  for (const row of due ?? []) {
    const { data: claim } = await admin
      .from('automation_pending_executions')
      .update({ status: 'running' })
      .eq('id', row.id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle()
    if (!claim) continue

    await resumePendingExecution({
      id: row.id as string,
      automation_id: row.automation_id as string,
      workspace_id: row.workspace_id as string,
      contact_id: (row.contact_id as string | null) ?? null,
      log_id: (row.log_id as string | null) ?? null,
      parent_step_id: (row.parent_step_id as string | null) ?? null,
      branch: (row.branch as 'yes' | 'no' | null) ?? null,
      next_step_position: row.next_step_position as number,
      context: (row.context as AutomationContext) ?? {},
    })
    processed++
  }

  let followups: { fired: number; skipped: number } | { error: string }
  try {
    followups = await processDueFollowups()
  } catch (err) {
    followups = { error: err instanceof Error ? err.message : String(err) }
  }

  let abandonedCarts: { reminded: number; skipped: number } | { error: string }
  try {
    abandonedCarts = await remindAbandonedCarts()
  } catch (err) {
    abandonedCarts = { error: err instanceof Error ? err.message : String(err) }
  }

  let taskReminders: Awaited<ReturnType<typeof remindDueTasks>> | { error: string }
  try {
    taskReminders = await remindDueTasks()
  } catch (err) {
    taskReminders = { error: err instanceof Error ? err.message : String(err) }
  }

  let googleCalendar: Awaited<ReturnType<typeof runGoogleCalendarCron>> | { error: string }
  try {
    googleCalendar = await runGoogleCalendarCron()
  } catch (err) {
    googleCalendar = { error: err instanceof Error ? err.message : String(err) }
  }

  // Real estate: listing ↔ lead alerts, viewing stage sync + post-visit question.
  let realEstate: { matches: Awaited<ReturnType<typeof processPropertyMatchJobs>>; viewings: Awaited<ReturnType<typeof processViewings>> } | { error: string }
  try {
    realEstate = { matches: await processPropertyMatchJobs(), viewings: await processViewings() }
  } catch (err) {
    realEstate = { error: err instanceof Error ? err.message : String(err) }
  }

  // Real estate: daily re-import from Mercado Libre / agency feeds.
  let portalImports: Awaited<ReturnType<typeof runScheduledPortalImports>> | { error: string }
  try {
    portalImports = await runScheduledPortalImports()
  } catch (err) {
    portalImports = { error: err instanceof Error ? err.message : String(err) }
  }

  // Outgoing webhooks (public API): deliveries + retries with backoff.
  let webhooks: Awaited<ReturnType<typeof processWebhookDeliveries>> | { error: string }
  try {
    webhooks = await processWebhookDeliveries()
  } catch (err) {
    webhooks = { error: err instanceof Error ? err.message : String(err) }
  }

  // Billing: missed Payment Latam webhooks + expired credits.
  let billing: Awaited<ReturnType<typeof runBillingCron>> | { error: string }
  try {
    billing = await runBillingCron()
  } catch (err) {
    billing = { error: err instanceof Error ? err.message : String(err) }
  }

  return NextResponse.json({ processed, followups, abandonedCarts, taskReminders, googleCalendar, realEstate, portalImports, webhooks, billing })
}

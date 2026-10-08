import 'server-only'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { createTranslator } from '@/i18n/translate'
import { notify } from '@/lib/inbox/server'
import { windowState } from '@/lib/automations/followup-rules'
import type { ChannelType } from '@/lib/channels'
import { leadsForProperty, isOfferable } from './match'
import { LEAD_SELECT, rowToLead, workspaceAdmins } from './service'
import { loadProperty, loadWs, sendProperties } from './properties'
import type { LeadProfile } from './types'

// Matching alerts: products of real-estate workspaces that are created,
// re-activated, re-priced or change status are queued by a DB trigger
// (property_match_jobs, migration 037). The cron drains the queue:
//  - each matching lead's owner (conversation assignee, else the admins)
//    gets one notification per listing: "3 leads coinciden con …"
//  - leads that opted in to alerts and whose reply window is open get the
//    listing in their chat. Outside the window only the team is told — no
//    paid templates are sent automatically.

const JOBS_PER_RUN = 20
const LEADS_SCAN = 2000

export interface MatchJobsResult {
  jobs: number
  notifications: number
  customerAlerts: number
}

export async function processPropertyMatchJobs(now = new Date()): Promise<MatchJobsResult> {
  const db = supabaseAdmin()
  const out: MatchJobsResult = { jobs: 0, notifications: 0, customerAlerts: 0 }
  const { data: due } = await db
    .from('property_match_jobs')
    .select('id, workspace_id, product_id, reason')
    .eq('status', 'pending')
    .lte('run_after', now.toISOString())
    .order('run_after')
    .limit(JOBS_PER_RUN)
  for (const job of due ?? []) {
    const { data: claim } = await db.from('property_match_jobs').update({ status: 'running' }).eq('id', job.id).eq('status', 'pending').select('id').maybeSingle()
    if (!claim) continue
    try {
      const r = await runMatchJob(job.workspace_id as string, job.product_id as string)
      out.jobs++
      out.notifications += r.notifications
      out.customerAlerts += r.customerAlerts
      await db.from('property_match_jobs').update({ status: 'done', processed_at: new Date().toISOString(), result: r }).eq('id', job.id)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[leads] match job failed:', msg)
      await db.from('property_match_jobs').update({ status: 'failed', processed_at: new Date().toISOString(), result: { error: msg } }).eq('id', job.id)
    }
  }
  return out
}

export interface MatchJobResult {
  leads: number
  notifications: number
  customerAlerts: number
  skipped?: string
}

/** Matches one listing against the workspace's leads and alerts. */
export async function runMatchJob(workspaceId: string, productId: string): Promise<MatchJobResult> {
  const db = supabaseAdmin()
  const [ws, property] = await Promise.all([loadWs(workspaceId), loadProperty(workspaceId, productId)])
  if (!ws || !property || !isOfferable(property)) return { leads: 0, notifications: 0, customerAlerts: 0, skipped: 'not_offerable' }

  const { data: rows } = await db
    .from('lead_profiles')
    .select(LEAD_SELECT)
    .eq('workspace_id', workspaceId)
    .not('qualified_at', 'is', null)
    .order('score', { ascending: false })
    .limit(LEADS_SCAN)
  const { data: already } = await db.from('lead_property_alerts').select('lead_profile_id').eq('workspace_id', workspaceId).eq('product_id', productId)
  const seen = new Set((already ?? []).map((a) => a.lead_profile_id as string))
  const leads = leadsForProperty(
    property,
    (rows ?? []).map(rowToLead).filter((l) => !seen.has(l.id)),
    { listingCurrency: ws.currency },
  )
  if (!leads.length) return { leads: 0, notifications: 0, customerAlerts: 0 }

  const t = createTranslator(ws.locale === 'en' ? 'en' : 'es')

  // Conversation owner + reply window of every matching lead.
  const convIds = leads.map((l) => l.conversation_id).filter((x): x is string => !!x)
  const { data: convs } = convIds.length
    ? await db
        .from('conversations')
        .select('id, assigned_agent_id, last_customer_message_at, channel:channels(type)')
        .eq('workspace_id', workspaceId)
        .in('id', convIds)
    : { data: [] }
  const convById = new Map((convs ?? []).map((c) => [c.id as string, c]))
  const { data: contacts } = await db.from('contacts').select('id, name, phone').in('id', leads.map((l) => l.contact_id))
  const nameOf = new Map((contacts ?? []).map((c) => [c.id as string, ((c.name as string) || (c.phone as string) || '').trim()]))

  // Notifications grouped by owner.
  const admins = await workspaceAdmins(workspaceId)
  const byOwner = new Map<string, LeadProfile[]>()
  for (const l of leads) {
    const conv = l.conversation_id ? convById.get(l.conversation_id) : undefined
    const owners = conv?.assigned_agent_id ? [conv.assigned_agent_id as string] : admins
    for (const o of owners) byOwner.set(o, [...(byOwner.get(o) ?? []), l])
  }
  const notes = [...byOwner.entries()].map(([userId, list]) => ({
    workspaceId,
    userId,
    type: 'system' as const,
    title: t(list.length === 1 ? 'leads.server.matchTitleOne' : 'leads.server.matchTitle', { count: list.length, property: property.name }),
    body: list
      .slice(0, 8)
      .map((l) => nameOf.get(l.contact_id) || t('leads.server.customer'))
      .join(', '),
    conversationId: list.length === 1 ? list[0].conversation_id : null,
  }))
  await notify(notes)

  // Customers who asked for alerts, inside the reply window.
  let customerAlerts = 0
  for (const l of leads) {
    const conv = l.conversation_id ? convById.get(l.conversation_id) : undefined
    let delivery: 'customer' | 'team' = 'team'
    if (l.alerts_opt_in && conv) {
      const type = ((conv.channel as unknown as { type?: ChannelType } | null)?.type ?? 'whatsapp') as ChannelType
      if (windowState(type, conv.last_customer_message_at as string | null).open) {
        const sent = await sendProperties({ workspaceId, conversationId: conv.id as string }, [property], t('leads.server.alertIntro'), 'property_alert')
        if (sent) {
          delivery = 'customer'
          customerAlerts++
        }
      }
    }
    await db.from('lead_property_alerts').upsert(
      { workspace_id: workspaceId, lead_profile_id: l.id, product_id: productId, delivery },
      { onConflict: 'lead_profile_id,product_id', ignoreDuplicates: true },
    )
    await db.from('lead_profiles').update({ last_matched_at: new Date().toISOString() }).eq('id', l.id).eq('workspace_id', workspaceId)
  }
  return { leads: leads.length, notifications: notes.length, customerAlerts }
}

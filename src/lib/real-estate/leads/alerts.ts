import 'server-only'
import { prisma } from '@/lib/db/prisma'
import { tenantDb } from '@/lib/db/tenant'
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
  const out: MatchJobsResult = { jobs: 0, notifications: 0, customerAlerts: 0 }
  // Cron across every workspace: platform client for the queue scan.
  const due = await prisma.property_match_jobs
    .findMany({
      select: { id: true, workspace_id: true, product_id: true, reason: true },
      where: { status: 'pending', run_after: { lte: now.toISOString() } },
      orderBy: { run_after: 'asc' },
      take: JOBS_PER_RUN,
    })
    .catch(() => null)
  for (const job of due ?? []) {
    const db = tenantDb(job.workspace_id)
    const claim = await db.property_match_jobs
      .updateMany({ where: { id: job.id, status: 'pending' }, data: { status: 'running' } })
      .catch(() => null)
    if (!claim?.count) continue
    try {
      const r = await runMatchJob(job.workspace_id as string, job.product_id as string)
      out.jobs++
      out.notifications += r.notifications
      out.customerAlerts += r.customerAlerts
      await db.property_match_jobs
        .updateMany({ where: { id: job.id }, data: { status: 'done', processed_at: new Date().toISOString(), result: { ...r } } })
        .catch(() => undefined)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[leads] match job failed:', msg)
      await db.property_match_jobs
        .updateMany({ where: { id: job.id }, data: { status: 'failed', processed_at: new Date().toISOString(), result: { error: msg } } })
        .catch(() => undefined)
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
  const db = tenantDb(workspaceId)
  const [ws, property] = await Promise.all([loadWs(workspaceId), loadProperty(workspaceId, productId)])
  if (!ws || !property || !isOfferable(property)) return { leads: 0, notifications: 0, customerAlerts: 0, skipped: 'not_offerable' }

  const rows = await db.lead_profiles
    .findMany({ select: LEAD_SELECT, where: { qualified_at: { not: null } }, orderBy: { score: 'desc' }, take: LEADS_SCAN })
    .catch(() => null)
  const already = await db.lead_property_alerts.findMany({ select: { lead_profile_id: true }, where: { product_id: productId } }).catch(() => null)
  const seen = new Set((already ?? []).map((a) => a.lead_profile_id))
  const leads = leadsForProperty(
    property,
    (rows ?? []).map(rowToLead).filter((l) => !seen.has(l.id)),
    { listingCurrency: ws.currency },
  )
  if (!leads.length) return { leads: 0, notifications: 0, customerAlerts: 0 }

  const t = createTranslator(ws.locale === 'en' ? 'en' : 'es')

  // Conversation owner + reply window of every matching lead.
  const convIds = leads.map((l) => l.conversation_id).filter((x): x is string => !!x)
  const convs = convIds.length
    ? await db.conversations
        .findMany({
          select: { id: true, assigned_agent_id: true, last_customer_message_at: true, channels: { select: { type: true } } },
          where: { id: { in: convIds } },
        })
        .then((list) => list.map(({ channels, ...c }) => ({ ...c, channel: channels })))
        .catch(() => null)
    : []
  const convById = new Map((convs ?? []).map((c) => [c.id as string, c]))
  const contacts = await db.contacts
    .findMany({ select: { id: true, name: true, phone: true }, where: { id: { in: leads.map((l) => l.contact_id) } } })
    .catch(() => null)
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
    await db.lead_property_alerts
      .createMany({ data: [{ workspace_id: workspaceId, lead_profile_id: l.id, product_id: productId, delivery }], skipDuplicates: true })
      .catch(() => undefined)
    await db.lead_profiles.updateMany({ where: { id: l.id }, data: { last_matched_at: new Date().toISOString() } }).catch(() => undefined)
  }
  return { leads: leads.length, notifications: notes.length, customerAlerts }
}

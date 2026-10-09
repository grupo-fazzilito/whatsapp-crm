import 'server-only'
import { tenantDb } from '@/lib/db/tenant'
import type { Prisma } from '@/generated/prisma/client'
import { createTranslator } from '@/i18n/translate'
import { contactNameOf, markAssigned, notify, pickAssignee, recordEvent, activeMemberIds } from '@/lib/inbox/server'
import { formatMoney, moneyLocale } from '@/lib/workspace/countries'
import { computeLeadScore, type Engagement } from './score'
import { isQualified, leadChanged, mergeLead } from './profile'
import { selectRule } from './routing'
import { dealOwnerUserId, moveContactDeal } from './pipeline'
import type { LeadFields, LeadProfile, RoutingRule, VisitFeedback } from './types'

// Lead profiles (tenant client: every query is confined to the workspace).

export const LEAD_SELECT = {
  id: true,
  workspace_id: true,
  contact_id: true,
  conversation_id: true,
  operation: true,
  property_types: true,
  zones: true,
  budget_min: true,
  budget_max: true,
  currency: true,
  bedrooms_min: true,
  bathrooms_min: true,
  parking_min: true,
  financing: true,
  mortgage_preapproved: true,
  move_in: true,
  purpose: true,
  notes: true,
  score: true,
  temperature: true,
  qualified_at: true,
  alerts_opt_in: true,
  last_matched_at: true,
  updated_by: true,
  created_at: true,
  updated_at: true,
} as const

function toNumber(v: unknown): number | null {
  return v === null || v === undefined ? null : Number(v)
}

export function rowToLead(row: Record<string, unknown>): LeadProfile {
  return {
    ...(row as unknown as LeadProfile),
    budget_min: toNumber(row.budget_min),
    budget_max: toNumber(row.budget_max),
    property_types: (row.property_types as string[]) ?? [],
    zones: (row.zones as string[]) ?? [],
  }
}

export async function getLeadProfile(workspaceId: string, contactId: string): Promise<LeadProfile | null> {
  const data = await tenantDb(workspaceId)
    .lead_profiles.findFirst({ select: LEAD_SELECT, where: { contact_id: contactId } })
    .catch(() => null)
  return data ? rowToLead(data) : null
}

/** Messages, viewings and the latest post-visit answer of a contact. */
export async function engagementOf(workspaceId: string, contactId: string): Promise<Engagement> {
  const db = tenantDb(workspaceId)
  const convs = await db.conversations.findMany({ select: { id: true }, where: { contact_id: contactId }, take: 20 }).catch(() => null)
  const ids = (convs ?? []).map((c) => c.id)
  const [msgs, viewings, feedback] = await Promise.all([
    ids.length ? db.messages.count({ where: { conversation_id: { in: ids }, sender_type: 'customer' } }).catch(() => 0) : Promise.resolve(0),
    // PostgREST's neq() never matched NULL status; keep that.
    db.bookings
      .count({ where: { contact_id: contactId, product_id: { not: null }, AND: [{ status: { not: null } }, { status: { not: 'cancelled' } }] } })
      .catch(() => 0),
    db.bookings
      .findFirst({ select: { viewing_feedback: true }, where: { contact_id: contactId, viewing_feedback: { not: null } }, orderBy: { updated_at: 'desc' } })
      .catch(() => null),
  ])
  return {
    inboundMessages: msgs,
    viewings,
    visitFeedback: ((feedback?.viewing_feedback as VisitFeedback | undefined) ?? null) as VisitFeedback | null,
  }
}

export interface SaveLeadInput {
  workspaceId: string
  contactId: string
  conversationId?: string | null
  patch: Partial<LeadFields>
  by: 'ai' | 'user'
  /** User replacing values (team edit): patch keys overwrite, even with empty values. */
  replace?: boolean
  /** Acting member (team edits) — not notified about their own action. */
  actorId?: string | null
}

export interface SaveLeadResult {
  profile: LeadProfile
  becameQualified: boolean
  routedTo: string | null
}

/**
 * Merges new facts into the contact's profile, re-scores it, and when the
 * profile becomes qualified for the first time moves the deal to
 * "Calificado" and applies the routing rules. AI patches never clear
 * values; nothing is created for an empty AI patch.
 */
export async function saveLeadProfile(input: SaveLeadInput): Promise<SaveLeadResult | null> {
  const db = tenantDb(input.workspaceId)
  const prev = await getLeadProfile(input.workspaceId, input.contactId)
  if (!prev && !Object.keys(input.patch).length) return null

  const fields: LeadFields = input.replace ? { ...mergeLead(prev, {}), ...input.patch } : mergeLead(prev, input.patch)
  const engagement = await engagementOf(input.workspaceId, input.contactId)
  const { score, temperature } = computeLeadScore(fields, engagement)
  const qualifiedNow = isQualified(fields)
  const becameQualified = qualifiedNow && !prev?.qualified_at

  const conversationId = input.conversationId ?? prev?.conversation_id ?? null
  const unchanged =
    prev && !leadChanged(prev, fields) && prev.score === score && prev.temperature === temperature && !becameQualified && prev.conversation_id === conversationId
  let profile: LeadProfile
  if (unchanged) {
    profile = prev
  } else {
    const row = {
      workspace_id: input.workspaceId,
      contact_id: input.contactId,
      conversation_id: conversationId,
      ...fields,
      score,
      temperature,
      qualified_at: prev?.qualified_at ?? (qualifiedNow ? new Date().toISOString() : null),
      updated_by: input.by,
    }
    try {
      const data = await db.lead_profiles.upsert({
        where: { workspace_id_contact_id: { workspace_id: input.workspaceId, contact_id: input.contactId } },
        create: row as Prisma.lead_profilesUncheckedCreateInput,
        update: row as Prisma.lead_profilesUncheckedUpdateInput,
        select: LEAD_SELECT,
      })
      profile = rowToLead(data)
    } catch (err) {
      console.error('[leads] profile save failed:', err instanceof Error ? err.message : err)
      return null
    }
  }

  let routedTo: string | null = null
  if (becameQualified) routedTo = await onQualified(profile, input.actorId ?? null)
  return { profile, becameQualified, routedTo }
}

/** Recomputes score/temperature (e.g. after a viewing or its feedback). */
export async function rescoreLead(workspaceId: string, contactId: string): Promise<LeadProfile | null> {
  const prev = await getLeadProfile(workspaceId, contactId)
  if (!prev) return null
  const { score, temperature } = computeLeadScore(prev, await engagementOf(workspaceId, contactId))
  if (score === prev.score && temperature === prev.temperature) return prev
  const data = await tenantDb(workspaceId)
    .lead_profiles.update({ where: { id: prev.id }, data: { score, temperature }, select: LEAD_SELECT })
    .catch(() => null)
  return data ? rowToLead(data) : prev
}

async function wsInfo(workspaceId: string) {
  const data = await tenantDb(workspaceId)
    .workspaces.findFirst({
      select: { id: true, name: true, slug: true, locale: true, country: true, currency: true, industry: true, settings: true },
      where: { id: workspaceId },
    })
    .catch(() => null)
  return data as { id: string; name: string; slug: string; locale: string; country: string | null; currency: string; industry: string; settings: Record<string, unknown> } | null
}

/** "Alquiler · Miraflores · hasta S/ 3,000 · 2+ dorm." */
export function leadSummary(p: Partial<LeadFields>, locale: string, ws: { currency: string; country?: string | null }): string {
  const t = createTranslator(locale === 'en' ? 'en' : 'es')
  const money = (n: number) => formatMoney(n, p.currency || ws.currency, moneyLocale({ locale: locale === 'en' ? 'en' : 'es', country: ws.country ?? null }))
  const budget =
    p.budget_min && p.budget_max
      ? `${money(p.budget_min)} – ${money(p.budget_max)}`
      : p.budget_max
        ? t('leads.server.upTo', { amount: money(p.budget_max) })
        : p.budget_min
          ? t('leads.server.from', { amount: money(p.budget_min) })
          : ''
  return [
    p.operation ? t(`leads.operation.${p.operation}`) : '',
    p.zones?.join(', ') ?? '',
    budget,
    p.bedrooms_min != null ? t('leads.server.bedrooms', { count: p.bedrooms_min }) : '',
  ]
    .filter(Boolean)
    .join(' · ')
}

async function activeRules(workspaceId: string): Promise<RoutingRule[]> {
  const data = await tenantDb(workspaceId)
    .real_estate_routing_rules.findMany({
      select: { id: true, workspace_id: true, name: true, priority: true, conditions: true, team_id: true, user_id: true, active: true, created_at: true },
      where: { active: true },
      orderBy: { priority: 'asc' },
    })
    .catch(() => null)
  return (data ?? []) as RoutingRule[]
}

/**
 * First qualification: deal → "Calificado" (created when missing), then
 * the first matching routing rule assigns the conversation (member, or
 * round robin inside a team). Returns the assignee. Never throws.
 */
export async function onQualified(profile: LeadProfile, actorId: string | null = null): Promise<string | null> {
  try {
    const ws = await wsInfo(profile.workspace_id)
    if (!ws) return null
    const t = createTranslator(ws.locale === 'en' ? 'en' : 'es')
    const routed = await routeLead(profile, actorId)
    const deal = await moveContactDeal({
      workspaceId: profile.workspace_id,
      contactId: profile.contact_id,
      conversationId: profile.conversation_id,
      key: 'qualified',
      createIfMissing: true,
      value: profile.budget_max ?? profile.budget_min,
      currency: profile.currency,
      assignUserId: routed,
    })

    // Already owned by someone (no rule matched or the chat had an owner): tell them.
    if (!routed) {
      const owner = (await conversationAssignee(profile)) ?? (deal ? await dealOwnerUserId(profile.workspace_id, profile.contact_id) : null)
      if (owner) {
        const name = (profile.conversation_id && (await contactNameOf(profile.conversation_id))) || t('leads.server.customer')
        await notify([
          {
            workspaceId: profile.workspace_id,
            userId: owner,
            type: 'system',
            title: t('leads.server.qualifiedTitle', { name }),
            body: leadSummary(profile, ws.locale, ws),
            conversationId: profile.conversation_id,
            actorId,
          },
        ])
      }
    }
    return routed
  } catch (err) {
    console.error('[leads] onQualified failed:', err instanceof Error ? err.message : err)
    return null
  }
}

async function conversationAssignee(profile: Pick<LeadProfile, 'workspace_id' | 'conversation_id'>): Promise<string | null> {
  if (!profile.conversation_id) return null
  const data = await tenantDb(profile.workspace_id)
    .conversations.findFirst({ select: { assigned_agent_id: true }, where: { id: profile.conversation_id } })
    .catch(() => null)
  return (data?.assigned_agent_id as string) ?? null
}

/**
 * Applies the routing rules to the lead's conversation (only when nobody
 * owns it yet). Returns the member assigned, or null.
 */
export async function routeLead(profile: LeadProfile, actorId: string | null = null): Promise<string | null> {
  if (!profile.conversation_id) return null
  const db = tenantDb(profile.workspace_id)
  const rule = selectRule(await activeRules(profile.workspace_id), profile)
  if (!rule) return null

  const conv = await db.conversations
    .findFirst({ select: { id: true, assigned_agent_id: true, team_id: true }, where: { id: profile.conversation_id } })
    .catch(() => null)
  if (!conv || conv.assigned_agent_id) return null

  let pick: string | null = null
  if (rule.user_id) {
    pick = (await activeMemberIds(profile.workspace_id, [rule.user_id]))[0] ?? null
  } else if (rule.team_id) {
    pick = await pickAssignee(profile.workspace_id, rule.team_id)
  }
  if (!pick) {
    // Nobody available in the team: park it there so the team sees it.
    if (rule.team_id && !conv.team_id) {
      await db.conversations.updateMany({ where: { id: conv.id }, data: { team_id: rule.team_id } }).catch(() => undefined)
    }
    return null
  }

  const updated = await db.conversations
    .updateMany({
      where: { id: conv.id, assigned_agent_id: null },
      data: { assigned_agent_id: pick, ...(rule.team_id ? { team_id: rule.team_id } : {}), updated_at: new Date().toISOString() },
    })
    .catch(() => null)
  if (!updated?.count) return null

  await markAssigned(profile.workspace_id, pick)
  await recordEvent({
    workspaceId: profile.workspace_id,
    conversationId: conv.id as string,
    type: 'assigned',
    toUser: pick,
    teamId: rule.team_id,
    note: rule.name,
    data: { auto: true, trigger: 'lead_routing', rule_id: rule.id },
  })
  const ws = await wsInfo(profile.workspace_id)
  const locale = ws?.locale ?? 'es'
  const t = createTranslator(locale === 'en' ? 'en' : 'es')
  const name = (await contactNameOf(conv.id as string)) || t('leads.server.customer')
  await notify([
    {
      workspaceId: profile.workspace_id,
      userId: pick,
      type: 'assigned',
      title: t('leads.server.routedTitle', { name }),
      body: ws ? `${leadSummary(profile, locale, ws)} · ${t('leads.server.rule', { rule: rule.name })}` : rule.name,
      conversationId: conv.id as string,
      actorId,
    },
  ])
  return pick
}

/**
 * Who should hear about this lead: deal owner, else the conversation's
 * assignee, else the advisor (staff linked to a member) of the booking.
 */
export async function advisorFor(
  workspaceId: string,
  contactId: string,
  conversationId: string | null,
  staffId?: string | null,
): Promise<string | null> {
  const owner = await dealOwnerUserId(workspaceId, contactId)
  if (owner) return owner
  if (conversationId) {
    const a = await conversationAssignee({ workspace_id: workspaceId, conversation_id: conversationId })
    if (a) return a
  }
  if (staffId) {
    const data = await tenantDb(workspaceId)
      .staff.findFirst({ select: { member_user_id: true }, where: { id: staffId } })
      .catch(() => null)
    if (data?.member_user_id) return data.member_user_id as string
  }
  return null
}

/** Owners/admins of the workspace (fallback recipients). */
export async function workspaceAdmins(workspaceId: string): Promise<string[]> {
  const data = await tenantDb(workspaceId)
    .workspace_members.findMany({ select: { user_id: true }, where: { status: 'active', role: { in: ['owner', 'admin'] } } })
    .catch(() => null)
  return (data ?? []).map((m) => m.user_id as string)
}

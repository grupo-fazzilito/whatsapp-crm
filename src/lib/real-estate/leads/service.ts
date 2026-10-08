import 'server-only'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { createTranslator } from '@/i18n/translate'
import { contactNameOf, markAssigned, notify, pickAssignee, recordEvent, activeMemberIds } from '@/lib/inbox/server'
import { formatMoney, moneyLocale } from '@/lib/workspace/countries'
import { computeLeadScore, type Engagement } from './score'
import { isQualified, leadChanged, mergeLead } from './profile'
import { selectRule } from './routing'
import { dealOwnerUserId, moveContactDeal } from './pipeline'
import type { LeadFields, LeadProfile, RoutingRule, VisitFeedback } from './types'

// Lead profiles (service role; every query carries the workspace filter).

export const LEAD_SELECT =
  'id, workspace_id, contact_id, conversation_id, operation, property_types, zones, budget_min, budget_max, currency, bedrooms_min, bathrooms_min, parking_min, financing, mortgage_preapproved, move_in, purpose, notes, score, temperature, qualified_at, alerts_opt_in, last_matched_at, updated_by, created_at, updated_at'

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
  const { data } = await supabaseAdmin()
    .from('lead_profiles')
    .select(LEAD_SELECT)
    .eq('workspace_id', workspaceId)
    .eq('contact_id', contactId)
    .maybeSingle()
  return data ? rowToLead(data) : null
}

/** Messages, viewings and the latest post-visit answer of a contact. */
export async function engagementOf(workspaceId: string, contactId: string): Promise<Engagement> {
  const db = supabaseAdmin()
  const { data: convs } = await db.from('conversations').select('id').eq('workspace_id', workspaceId).eq('contact_id', contactId).limit(20)
  const ids = (convs ?? []).map((c) => c.id as string)
  const [msgs, viewings, feedback] = await Promise.all([
    ids.length
      ? db.from('messages').select('id', { count: 'exact', head: true }).in('conversation_id', ids).eq('sender_type', 'customer')
      : Promise.resolve({ count: 0 }),
    db
      .from('bookings')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .eq('contact_id', contactId)
      .not('product_id', 'is', null)
      .neq('status', 'cancelled'),
    db
      .from('bookings')
      .select('viewing_feedback')
      .eq('workspace_id', workspaceId)
      .eq('contact_id', contactId)
      .not('viewing_feedback', 'is', null)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])
  return {
    inboundMessages: (msgs as { count: number | null }).count ?? 0,
    viewings: viewings.count ?? 0,
    visitFeedback: ((feedback.data?.viewing_feedback as VisitFeedback | undefined) ?? null) as VisitFeedback | null,
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
  const db = supabaseAdmin()
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
    const { data, error } = await db.from('lead_profiles').upsert(row, { onConflict: 'workspace_id,contact_id' }).select(LEAD_SELECT).single()
    if (error || !data) {
      console.error('[leads] profile save failed:', error?.message)
      return null
    }
    profile = rowToLead(data)
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
  const { data } = await supabaseAdmin()
    .from('lead_profiles')
    .update({ score, temperature })
    .eq('id', prev.id)
    .eq('workspace_id', workspaceId)
    .select(LEAD_SELECT)
    .single()
  return data ? rowToLead(data) : prev
}

async function wsInfo(workspaceId: string) {
  const { data } = await supabaseAdmin().from('workspaces').select('id, name, slug, locale, country, currency, industry, settings').eq('id', workspaceId).maybeSingle()
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
  const { data } = await supabaseAdmin()
    .from('real_estate_routing_rules')
    .select('id, workspace_id, name, priority, conditions, team_id, user_id, active, created_at')
    .eq('workspace_id', workspaceId)
    .eq('active', true)
    .order('priority')
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
  const { data } = await supabaseAdmin()
    .from('conversations')
    .select('assigned_agent_id')
    .eq('id', profile.conversation_id)
    .eq('workspace_id', profile.workspace_id)
    .maybeSingle()
  return (data?.assigned_agent_id as string) ?? null
}

/**
 * Applies the routing rules to the lead's conversation (only when nobody
 * owns it yet). Returns the member assigned, or null.
 */
export async function routeLead(profile: LeadProfile, actorId: string | null = null): Promise<string | null> {
  if (!profile.conversation_id) return null
  const db = supabaseAdmin()
  const rule = selectRule(await activeRules(profile.workspace_id), profile)
  if (!rule) return null

  const { data: conv } = await db
    .from('conversations')
    .select('id, assigned_agent_id, team_id')
    .eq('id', profile.conversation_id)
    .eq('workspace_id', profile.workspace_id)
    .maybeSingle()
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
      await db.from('conversations').update({ team_id: rule.team_id }).eq('id', conv.id).eq('workspace_id', profile.workspace_id)
    }
    return null
  }

  const { data: updated } = await db
    .from('conversations')
    .update({ assigned_agent_id: pick, ...(rule.team_id ? { team_id: rule.team_id } : {}), updated_at: new Date().toISOString() })
    .eq('id', conv.id)
    .eq('workspace_id', profile.workspace_id)
    .is('assigned_agent_id', null)
    .select('id')
    .maybeSingle()
  if (!updated) return null

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
    const { data } = await supabaseAdmin().from('staff').select('member_user_id').eq('id', staffId).eq('workspace_id', workspaceId).maybeSingle()
    if (data?.member_user_id) return data.member_user_id as string
  }
  return null
}

/** Owners/admins of the workspace (fallback recipients). */
export async function workspaceAdmins(workspaceId: string): Promise<string[]> {
  const { data } = await supabaseAdmin()
    .from('workspace_members')
    .select('user_id')
    .eq('workspace_id', workspaceId)
    .eq('status', 'active')
    .in('role', ['owner', 'admin'])
  return (data ?? []).map((m) => m.user_id as string)
}

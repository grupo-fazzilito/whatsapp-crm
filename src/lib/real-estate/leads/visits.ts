import 'server-only'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { sendMessage } from '@/lib/messaging/send'
import { createTranslator } from '@/i18n/translate'
import { notify } from '@/lib/inbox/server'
import { windowState } from '@/lib/automations/followup-rules'
import { zonedTimeToUtc } from '@/lib/bookings/reminders'
import { safeTimeZone } from '@/lib/ai/time'
import type { ChannelType } from '@/lib/channels'
import { moveContactDeal } from './pipeline'
import { advisorFor, getLeadProfile, rescoreLead, workspaceAdmins } from './service'
import { loadProperty, loadWs, matchingProperties, sendProperties, sendPropertyLocation } from './properties'
import { normalizeOperation } from './profile'
import { VISIT_FEEDBACK, type LeadFields, type MatchProperty, type VisitFeedback } from './types'

// Viewings (bookings with a property) of real-estate workspaces:
//  - confirmed → deal "Visita agendada" + property location to the customer
//  - reminder before the visit → location again (once)
//  - booking time + 2h → "¿Qué te pareció?" buttons; the answer moves the
//    deal (Visitó / Negociación), updates the lead temperature, tells the
//    advisor, and "Quiero ver otras" sends matching listings.
//
// Button ids (handled before the AI, like the commerce buttons):
//   visit:interested:<bookingId>  visit:others:<bookingId>
//   visit:not_convinced:<bookingId>  visit:book:<productId>

export const VISIT_PREFIX = 'visit:'

export function isVisitAction(id: string | null | undefined): id is string {
  return !!id && id.startsWith(VISIT_PREFIX)
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type VisitAction = { kind: 'feedback'; feedback: VisitFeedback; bookingId: string } | { kind: 'book'; productId: string }

export function parseVisitAction(id: string): VisitAction | null {
  const [prefix, action, ref] = id.split(':')
  if (`${prefix}:` !== VISIT_PREFIX || !ref || !UUID.test(ref)) return null
  if (action === 'book') return { kind: 'book', productId: ref }
  if ((VISIT_FEEDBACK as readonly string[]).includes(action)) return { kind: 'feedback', feedback: action as VisitFeedback, bookingId: ref }
  return null
}

/** Feedback answer → deal stage. */
export function stageForFeedback(f: VisitFeedback): 'negotiation' | 'viewed' {
  return f === 'interested' ? 'negotiation' : 'viewed'
}

export interface VisitCtx {
  workspaceId: string
  conversationId: string
  contactId: string
  aiAgentId?: string | null
}

async function isRealEstate(workspaceId: string): Promise<boolean> {
  const { data } = await supabaseAdmin().from('workspaces').select('industry').eq('id', workspaceId).maybeSingle()
  return data?.industry === 'real_estate'
}

async function say(ctx: VisitCtx, text: string, metadata?: Record<string, unknown>) {
  return sendMessage({
    workspaceId: ctx.workspaceId,
    conversationId: ctx.conversationId,
    content: { type: 'text', text },
    sender: { type: 'bot', aiAgentId: ctx.aiAgentId ?? null },
    metadata,
  })
}

/** A lead-like profile from a listing (when the customer has none yet). */
function profileFromProperty(p: MatchProperty): Partial<LeadFields> {
  const op = normalizeOperation(p.attributes.operation === 'sale' ? 'buy' : (p.attributes.operation as string))
  const zone = typeof p.attributes.zone === 'string' ? p.attributes.zone : null
  const beds = Number(p.attributes.bedrooms)
  return {
    operation: op,
    zones: zone ? [zone] : [],
    budget_max: p.price ?? null,
    currency: p.currency ?? null,
    bedrooms_min: Number.isFinite(beds) && beds > 0 ? beds : null,
  }
}

/**
 * Handles a tapped visit button. Returns true when the message was
 * consumed (the AI must not answer it).
 */
export async function handleVisitAction(ctx: VisitCtx, id: string): Promise<boolean> {
  const action = parseVisitAction(id)
  if (!action) return false
  const db = supabaseAdmin()
  const ws = await loadWs(ctx.workspaceId)
  if (!ws) return false
  const t = createTranslator(ws.locale === 'en' ? 'en' : 'es')

  if (action.kind === 'book') {
    const p = await loadProperty(ctx.workspaceId, action.productId)
    if (!p || !p.is_active) {
      await say(ctx, t('leads.server.notAvailable'))
      return true
    }
    // Start a viewing draft for this listing; the agent asks date and time next.
    const { data: conv } = await db.from('conversations').select('ai_state').eq('id', ctx.conversationId).eq('workspace_id', ctx.workspaceId).maybeSingle()
    const state = (conv?.ai_state ?? {}) as Record<string, unknown>
    const booking = { ...((state.booking as Record<string, unknown>) ?? {}), product_id: p.id }
    await db.from('conversations').update({ ai_state: { ...state, booking } }).eq('id', ctx.conversationId).eq('workspace_id', ctx.workspaceId)
    await say(ctx, t('leads.server.askViewingTime', { name: p.name }), { event: 'viewing_request', product_id: p.id })
    return true
  }

  const { data: booking } = await db
    .from('bookings')
    .select('id, contact_id, product_id, staff_id, conversation_id, viewing_feedback')
    .eq('id', action.bookingId)
    .eq('workspace_id', ctx.workspaceId)
    .maybeSingle()
  if (!booking || booking.contact_id !== ctx.contactId) return false

  await db.from('bookings').update({ viewing_feedback: action.feedback }).eq('id', booking.id).eq('workspace_id', ctx.workspaceId)
  const deal = await moveContactDeal({
    workspaceId: ctx.workspaceId,
    contactId: ctx.contactId,
    conversationId: ctx.conversationId,
    key: stageForFeedback(action.feedback),
    createIfMissing: true,
  })
  const lead = await rescoreLead(ctx.workspaceId, ctx.contactId)
  const property = booking.product_id ? await loadProperty(ctx.workspaceId, booking.product_id as string) : null

  // Tell the advisor (or the admins when nobody owns the lead).
  const advisor = await advisorFor(ctx.workspaceId, ctx.contactId, ctx.conversationId, booking.staff_id as string | null)
  const recipients = advisor ? [advisor] : await workspaceAdmins(ctx.workspaceId)
  const { data: contact } = await db.from('contacts').select('name, phone').eq('id', ctx.contactId).maybeSingle()
  const name = (contact?.name as string) || (contact?.phone as string) || t('leads.server.customer')
  await notify(
    recipients.map((userId) => ({
      workspaceId: ctx.workspaceId,
      userId,
      type: 'system' as const,
      title: t(`leads.server.feedbackTitle.${action.feedback}`, { name }),
      body: [property?.name, lead ? t(`leads.temperature.${lead.temperature}`) : '', deal ? t(`leads.server.stage.${stageForFeedback(action.feedback)}`) : '']
        .filter(Boolean)
        .join(' · '),
      conversationId: ctx.conversationId,
    })),
  )

  await say(ctx, t(`leads.server.feedbackReply.${action.feedback}`), { event: 'viewing_feedback', booking_id: booking.id, feedback: action.feedback })
  if (action.feedback === 'others') {
    const profile = lead ?? (await getLeadProfile(ctx.workspaceId, ctx.contactId))
    const criteria = profile ?? (property ? profileFromProperty(property) : null)
    const matches = criteria
      ? await matchingProperties(ctx.workspaceId, criteria, { limit: 5, excludeIds: booking.product_id ? [booking.product_id as string] : [] })
      : []
    if (matches.length) {
      await sendProperties(
        { workspaceId: ctx.workspaceId, conversationId: ctx.conversationId, aiAgentId: ctx.aiAgentId },
        matches.map((m) => m.product),
        t('leads.server.othersIntro'),
        'viewing_alternatives',
      )
    } else {
      await say(ctx, t('leads.server.noAlternatives'))
    }
  }
  return true
}

/**
 * A viewing was confirmed (AI or team): deal → "Visita agendada" and the
 * property's location goes to the customer. Idempotent per booking.
 */
export async function onViewingConfirmed(workspaceId: string, bookingId: string, opts: { sendLocation?: boolean; aiAgentId?: string | null } = {}): Promise<void> {
  try {
    const db = supabaseAdmin()
    const { data: b } = await db
      .from('bookings')
      .select('id, contact_id, conversation_id, product_id, status, viewing_stage_synced_at')
      .eq('id', bookingId)
      .eq('workspace_id', workspaceId)
      .maybeSingle()
    if (!b?.product_id || !b.contact_id || b.status !== 'confirmed') return
    if (!(await isRealEstate(workspaceId))) return
    if (!b.viewing_stage_synced_at) {
      // Claim first so a concurrent cron run doesn't do it twice.
      const { data: claimed } = await db
        .from('bookings')
        .update({ viewing_stage_synced_at: new Date().toISOString() })
        .eq('id', b.id)
        .is('viewing_stage_synced_at', null)
        .select('id')
        .maybeSingle()
      if (claimed) {
        await moveContactDeal({
          workspaceId,
          contactId: b.contact_id as string,
          conversationId: (b.conversation_id as string) ?? null,
          key: 'viewing_scheduled',
          createIfMissing: true,
        })
        await rescoreLead(workspaceId, b.contact_id as string)
      }
    }
    if (opts.sendLocation && b.conversation_id) {
      const p = await loadProperty(workspaceId, b.product_id as string)
      if (p) await sendPropertyLocation({ workspaceId, conversationId: b.conversation_id as string, aiAgentId: opts.aiAgentId }, p, { booking_id: b.id })
    }
  } catch (err) {
    console.error('[leads] onViewingConfirmed failed:', err instanceof Error ? err.message : err)
  }
}

/**
 * Hook for the booking reminder cron: with the last reminder before the
 * visit (≤ 5 h), the property location is sent once more.
 */
export async function afterViewingReminder(workspaceId: string, bookingId: string, hoursUntil: number): Promise<void> {
  if (hoursUntil > 5) return
  try {
    const db = supabaseAdmin()
    const { data: claimed } = await db
      .from('bookings')
      .update({ viewing_location_sent_at: new Date().toISOString() })
      .eq('id', bookingId)
      .eq('workspace_id', workspaceId)
      .not('product_id', 'is', null)
      .is('viewing_location_sent_at', null)
      .select('product_id, contact_id, conversation_id')
      .maybeSingle()
    if (!claimed?.product_id || !(await isRealEstate(workspaceId))) return
    const conversationId = (claimed.conversation_id as string | null) ?? (await latestConversation(workspaceId, claimed.contact_id as string))
    if (!conversationId) return
    const p = await loadProperty(workspaceId, claimed.product_id as string)
    if (p) await sendPropertyLocation({ workspaceId, conversationId }, p, { booking_id: bookingId, reminder: true })
  } catch (err) {
    console.error('[leads] viewing reminder location failed:', err instanceof Error ? err.message : err)
  }
}

/** Is it time to ask how the visit went? (start + 2 h … start + 48 h) */
export function feedbackDue(date: string, time: string, timeZone: string, now: Date): boolean {
  const start = zonedTimeToUtc(date, time, timeZone).getTime()
  const elapsed = now.getTime() - start
  return elapsed >= 2 * 3_600_000 && elapsed <= 48 * 3_600_000
}

export interface ViewingCronResult {
  stagesSynced: number
  feedbackSent: number
  feedbackSkipped: number
}

/**
 * Cron: deal stage for viewings booked by the team (the AI path does it
 * immediately) and the post-visit question 2 hours after the visit — only
 * inside the channel's reply window (no paid templates).
 */
export async function processViewings(now = new Date()): Promise<ViewingCronResult> {
  const db = supabaseAdmin()
  const out: ViewingCronResult = { stagesSynced: 0, feedbackSent: 0, feedbackSkipped: 0 }
  const day = (d: number) => new Date(now.getTime() + d * 86_400_000).toISOString().slice(0, 10)

  const { data: toSync } = await db
    .from('bookings')
    .select('id, workspace_id, workspace:workspaces!inner(industry)')
    .eq('workspace.industry', 'real_estate')
    .eq('status', 'confirmed')
    .not('product_id', 'is', null)
    .is('viewing_stage_synced_at', null)
    .gte('booking_date', day(-2))
    .limit(100)
  for (const b of toSync ?? []) {
    await onViewingConfirmed(b.workspace_id as string, b.id as string)
    out.stagesSynced++
  }

  const { data: visited } = await db
    .from('bookings')
    .select(
      'id, workspace_id, contact_id, conversation_id, booking_date, booking_time, status, ai_agent_id, workspace:workspaces!inner(industry, timezone, locale)',
    )
    .eq('workspace.industry', 'real_estate')
    .in('status', ['confirmed', 'completed'])
    .not('product_id', 'is', null)
    .is('viewing_feedback_sent_at', null)
    .gte('booking_date', day(-3))
    .lte('booking_date', day(1))
    .limit(200)
  for (const b of visited ?? []) {
    const w = b.workspace as unknown as { timezone: string | null; locale: string }
    if (!feedbackDue(b.booking_date as string, b.booking_time as string, safeTimeZone(w.timezone), now)) continue
    // Claim so overlapping runs never ask twice.
    const { data: claimed } = await db
      .from('bookings')
      .update({ viewing_feedback_sent_at: now.toISOString() })
      .eq('id', b.id)
      .is('viewing_feedback_sent_at', null)
      .select('id')
      .maybeSingle()
    if (!claimed) continue
    const sent = await askVisitFeedback({
      workspaceId: b.workspace_id as string,
      bookingId: b.id as string,
      contactId: b.contact_id as string,
      conversationId: (b.conversation_id as string) ?? null,
      locale: w.locale,
      aiAgentId: (b.ai_agent_id as string) ?? null,
    })
    if (sent) out.feedbackSent++
    else out.feedbackSkipped++
  }
  return out
}

async function latestConversation(workspaceId: string, contactId: string): Promise<string | null> {
  const { data } = await supabaseAdmin()
    .from('conversations')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('contact_id', contactId)
    .not('channel_id', 'is', null)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle()
  return (data?.id as string) ?? null
}

async function askVisitFeedback(input: {
  workspaceId: string
  bookingId: string
  contactId: string
  conversationId: string | null
  locale: string
  aiAgentId: string | null
}): Promise<boolean> {
  const db = supabaseAdmin()
  const conversationId = input.conversationId ?? (await latestConversation(input.workspaceId, input.contactId))
  if (!conversationId) return false
  const { data: conv } = await db
    .from('conversations')
    .select('last_customer_message_at, channel:channels(type)')
    .eq('id', conversationId)
    .maybeSingle()
  const type = ((conv?.channel as unknown as { type?: ChannelType } | null)?.type ?? 'whatsapp') as ChannelType
  if (!windowState(type, conv?.last_customer_message_at as string | null).open) return false

  const t = createTranslator(input.locale === 'en' ? 'en' : 'es')
  const res = await sendMessage({
    workspaceId: input.workspaceId,
    conversationId,
    content: {
      type: 'buttons',
      text: t('leads.server.feedbackQuestion'),
      options: VISIT_FEEDBACK.map((f) => ({ id: `visit:${f}:${input.bookingId}`, title: t(`leads.server.feedbackButton.${f}`) })),
    },
    sender: { type: 'bot', aiAgentId: input.aiAgentId },
    metadata: { event: 'viewing_feedback_request', booking_id: input.bookingId },
  })
  return res.status !== 'failed'
}

import 'server-only'
import { prisma } from '@/lib/db/prisma'
import { tenantDb } from '@/lib/db/tenant'
import type { Prisma } from '@/generated/prisma/client'
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
  const data = await tenantDb(workspaceId)
    .workspaces.findFirst({ select: { industry: true }, where: { id: workspaceId } })
    .catch(() => null)
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
  const db = tenantDb(ctx.workspaceId)
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
    const conv = await db.conversations.findFirst({ select: { ai_state: true }, where: { id: ctx.conversationId } }).catch(() => null)
    const state = (conv?.ai_state ?? {}) as Record<string, unknown>
    const booking = { ...((state.booking as Record<string, unknown>) ?? {}), product_id: p.id }
    await db.conversations
      .updateMany({ where: { id: ctx.conversationId }, data: { ai_state: { ...state, booking } as Prisma.InputJsonValue } })
      .catch(() => undefined)
    await say(ctx, t('leads.server.askViewingTime', { name: p.name }), { event: 'viewing_request', product_id: p.id })
    return true
  }

  const booking = await db.bookings
    .findFirst({
      select: { id: true, contact_id: true, product_id: true, staff_id: true, conversation_id: true, viewing_feedback: true },
      where: { id: action.bookingId },
    })
    .catch(() => null)
  if (!booking || booking.contact_id !== ctx.contactId) return false

  await db.bookings.updateMany({ where: { id: booking.id }, data: { viewing_feedback: action.feedback } }).catch(() => undefined)
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
  const contact = await db.contacts.findFirst({ select: { name: true, phone: true }, where: { id: ctx.contactId } }).catch(() => null)
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
    const db = tenantDb(workspaceId)
    const b = await db.bookings
      .findFirst({
        select: { id: true, contact_id: true, conversation_id: true, product_id: true, status: true, viewing_stage_synced_at: true },
        where: { id: bookingId },
      })
      .catch(() => null)
    if (!b?.product_id || !b.contact_id || b.status !== 'confirmed') return
    if (!(await isRealEstate(workspaceId))) return
    if (!b.viewing_stage_synced_at) {
      // Claim first so a concurrent cron run doesn't do it twice.
      const claimed = await db.bookings
        .updateMany({ where: { id: b.id, viewing_stage_synced_at: null }, data: { viewing_stage_synced_at: new Date().toISOString() } })
        .catch(() => null)
      if (claimed?.count) {
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
    const db = tenantDb(workspaceId)
    const res = await db.bookings
      .updateManyAndReturn({
        where: { id: bookingId, product_id: { not: null }, viewing_location_sent_at: null },
        data: { viewing_location_sent_at: new Date().toISOString() },
        select: { product_id: true, contact_id: true, conversation_id: true },
      })
      .catch(() => null)
    const claimed = res?.[0] ?? null
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
  // Cron across every real-estate workspace: platform client for the scans.
  const db = prisma
  const out: ViewingCronResult = { stagesSynced: 0, feedbackSent: 0, feedbackSkipped: 0 }
  const day = (d: number) => new Date(now.getTime() + d * 86_400_000).toISOString().slice(0, 10)

  const toSync = await db.bookings
    .findMany({
      select: { id: true, workspace_id: true },
      where: {
        workspaces: { industry: 'real_estate' },
        status: 'confirmed',
        product_id: { not: null },
        viewing_stage_synced_at: null,
        booking_date: { gte: day(-2) },
      },
      take: 100,
    })
    .catch(() => null)
  for (const b of toSync ?? []) {
    await onViewingConfirmed(b.workspace_id as string, b.id as string)
    out.stagesSynced++
  }

  const visited = await db.bookings
    .findMany({
      select: {
        id: true,
        workspace_id: true,
        contact_id: true,
        conversation_id: true,
        booking_date: true,
        booking_time: true,
        status: true,
        ai_agent_id: true,
        workspaces: { select: { industry: true, timezone: true, locale: true } },
      },
      where: {
        workspaces: { industry: 'real_estate' },
        status: { in: ['confirmed', 'completed'] },
        product_id: { not: null },
        viewing_feedback_sent_at: null,
        booking_date: { gte: day(-3), lte: day(1) },
      },
      take: 200,
    })
    .catch(() => null)
  for (const b of visited ?? []) {
    const w = b.workspaces as unknown as { timezone: string | null; locale: string }
    if (!feedbackDue(b.booking_date as string, b.booking_time as string, safeTimeZone(w.timezone), now)) continue
    // Claim so overlapping runs never ask twice.
    const claimed = await tenantDb(b.workspace_id)
      .bookings.updateMany({ where: { id: b.id, viewing_feedback_sent_at: null }, data: { viewing_feedback_sent_at: now.toISOString() } })
      .catch(() => null)
    if (!claimed?.count) continue
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
  const data = await tenantDb(workspaceId)
    .conversations.findFirst({
      select: { id: true },
      where: { contact_id: contactId, channel_id: { not: null } },
      orderBy: { last_message_at: { sort: 'desc', nulls: 'last' } },
    })
    .catch(() => null)
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
  const db = tenantDb(input.workspaceId)
  const conversationId = input.conversationId ?? (await latestConversation(input.workspaceId, input.contactId))
  if (!conversationId) return false
  const conv = await db.conversations
    .findFirst({ select: { last_customer_message_at: true, channels: { select: { type: true } } }, where: { id: conversationId } })
    .catch(() => null)
  const type = ((conv?.channels as unknown as { type?: ChannelType } | null)?.type ?? 'whatsapp') as ChannelType
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

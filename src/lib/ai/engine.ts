import 'server-only'
import { canSpend, spend } from '@/lib/billing/credits'
import { messageTextForAi } from './assist/core'
import { tenantDb } from '@/lib/db/tenant'
import type { Prisma } from '@/generated/prisma/client'
import { sendMessage } from '@/lib/messaging/send'
import { getPreset, industryLabel } from '@/lib/industries'
import type { LoadedChannel } from '@/lib/channels'
import { loadBusinessContext, type BusinessContext } from './context'
import { completeJson, llmConfigured, parseJsonLoose, type ChatTurn } from './llm'
import { agentOutputSchema, buildSystemPrompt, type AgentOutput } from './prompt'
import { cancelNextBooking, createBookingFromDraft } from './bookings'
import { calendlySlotsForPrompt } from '@/lib/integrations/calendly/booking'
import { businessWindows } from './slots'
import { isIsoDate, toMinutes, zonedNow } from './time'
import { getProducts, searchProducts, type CatalogQuery } from '@/lib/catalog/search'
import { formatProductPrice, parseCurrency } from '@/lib/catalog/currency'
import { addToCart, cartItems, getOpenCart, setLineQuantity } from '@/lib/orders/service'
import { ordersEnabled, productAction, sendCartSummary, sendProductCarousel, startCheckout, type CommerceCtx } from '@/lib/orders/chat'
import { texts } from '@/lib/orders/texts'
import type { AiAgentRow, BookingDraft, ConversationAiState } from './types'
import { autoAssignConversation } from '@/lib/inbox/server'
import { qualifiesLeads } from '@/lib/real-estate/leads/prompt-section'
import { applyAiCapture, applyAiLeadProfile, leadForPrompt } from '@/lib/real-estate/leads/ai'
import { onViewingConfirmed } from '@/lib/real-estate/leads/visits'

export const HANDOVER_PAUSE_MS = 12 * 60 * 60 * 1000
const HISTORY_TURNS = 14
const CHANNEL_LABEL: Record<string, string> = {
  whatsapp: 'WhatsApp',
  instagram: 'Instagram Direct',
  messenger: 'Facebook Messenger',
  tiktok: 'TikTok',
  webchat: 'the website chat',
}

type Lang = 'es' | 'en'

const TEXT: Record<Lang, Record<string, string>> = {
  es: {
    handover: 'Gracias por escribir. En breve una persona del equipo continúa la conversación. 🙏',
    booked: '✅ ¡Listo! Quedó confirmada la reserva: {booking} el *{date}* a las *{time}*{extra}.',
    bookingLink: 'Para confirmar tu {booking} del *{date}* a las *{time}*, termina la reserva aquí: {url}',
    slotTaken: 'Ese horario ya no está disponible. Opciones para ese día: {alts}.',
    closed: 'Ese día no hay disponibilidad. ¿Buscamos otra fecha?',
    past: 'Esa fecha u hora ya pasó. ¿Qué otro día sería conveniente?',
    cancelled: 'Listo, quedó cancelada la reserva: {booking} del *{date}* a las *{time}*.',
    noBooking: 'No encontré una reserva próxima con estos datos. ¿Cuál es la fecha de la reserva?',
    fallback: 'Disculpa, no pude procesar tu mensaje. Te comunico con una persona del equipo.',
    missing: 'Para confirmar la reserva ({booking}) falta: {fields}.',
    notConfirmed: 'No se pudo confirmar la reserva ({booking}) con esos datos. ¿Revisamos la fecha y la hora, o paso la conversación a una persona del equipo?',
    with: ' con {staff}',
    for: ' para {service}',
  },
  en: {
    handover: 'Thanks for reaching out. I’m connecting you with a team member who will reply shortly. 🙏',
    booked: '✅ Done! Your {booking} is confirmed for *{date}* at *{time}*{extra}.',
    bookingLink: 'To confirm your {booking} on *{date}* at *{time}*, finish booking here: {url}',
    slotTaken: 'That time is no longer available. Options that day: {alts}. Which one works for you?',
    closed: 'There’s no availability that day. Shall I suggest another date?',
    past: 'That date or time has already passed. What other day works for you?',
    cancelled: 'Your {booking} on *{date}* at *{time}* has been cancelled.',
    noBooking: 'I couldn’t find an upcoming booking under your name. Could you share the date?',
    fallback: 'Sorry, I couldn’t process your message. I’m connecting you with a team member.',
    missing: 'To confirm your {booking} I still need: {fields}. Could you share it?',
    notConfirmed: 'I couldn’t confirm your {booking} with those details. Shall we review the date and time, or would you like me to connect you with a team member?',
    with: ' with {staff}',
    for: ' for {service}',
  },
}

function fill(s: string, vars: Record<string, string>) {
  return s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '')
}

function pickLang(agent: AiAgentRow, ctx: BusinessContext, detected?: string | null): Lang {
  if (agent.language === 'es' || agent.language === 'en') return agent.language
  if (detected?.toLowerCase().startsWith('en')) return 'en'
  if (detected?.toLowerCase().startsWith('es')) return 'es'
  return ctx.workspace.locale
}

export interface RunAgentInput {
  workspaceId: string
  channel: LoadedChannel
  agent: AiAgentRow
  contactId: string
  conversationId: string
  messageText: string
  contextMessageId?: string | null
  isFirstInboundMessage: boolean
  /** Internal: transfer depth guard. */
  depth?: number
}

/** Writes whose failure the agent ignores (as it did with PostgREST's `{ error }`). */
async function quiet(p: Promise<unknown>): Promise<void> {
  try {
    await p
  } catch (err) {
    console.warn('[ai] write failed:', err instanceof Error ? err.message.slice(0, 300) : err)
  }
}

async function reply(input: RunAgentInput, agent: AiAgentRow, text: string, quote = false) {
  let replyToMessageId: string | null = null
  if (quote && input.contextMessageId) {
    const data = await tenantDb(input.workspaceId)
      .messages.findFirst({ select: { id: true }, where: { conversation_id: input.conversationId, message_id: input.contextMessageId } })
      .catch(() => null)
    replyToMessageId = data?.id ?? null
  }
  return sendMessage({
    workspaceId: input.workspaceId,
    conversationId: input.conversationId,
    content: { type: 'text', text },
    sender: { type: 'bot', aiAgentId: agent.id },
    replyToMessageId,
  })
}

async function log(input: RunAgentInput, agent: AiAgentRow, response: string, intent: string, confidence: number) {
  await quiet(tenantDb(input.workspaceId).ai_chat_logs.create({ data: {
    workspace_id: input.workspaceId,
    contact_id: input.contactId,
    conversation_id: input.conversationId,
    channel_id: input.channel.id,
    ai_agent_id: agent.id,
    user_message: input.messageText,
    ai_response: response,
    detected_intent: intent,
    confidence_score: Math.max(0, Math.min(1, confidence)),
  } }))
}

async function setState(workspaceId: string, conversationId: string, patch: Record<string, unknown>) {
  await quiet(tenantDb(workspaceId).conversations.updateMany({ where: { id: conversationId }, data: patch as Prisma.conversationsUncheckedUpdateManyInput }))
}

/** Pass to humans: pause the AI, flag the conversation, leave a note. */
export async function handOverToHuman(
  input: Pick<RunAgentInput, 'workspaceId' | 'contactId' | 'conversationId' | 'messageText'>,
  reason: string,
  assigneeUserId?: string | null,
) {
  const db = tenantDb(input.workspaceId)
  const conv = await db.conversations.findFirst({ select: { unread_count: true }, where: { id: input.conversationId } }).catch(() => null)
  await setState(input.workspaceId, input.conversationId, {
    status: 'open',
    ai_paused_until: new Date(Date.now() + HANDOVER_PAUSE_MS).toISOString(),
    unread_count: Math.max(1, conv?.unread_count ?? 0),
    ...(assigneeUserId ? { assigned_agent_id: assigneeUserId } : {}),
  })
  await quiet(db.contact_notes.create({ data: {
    workspace_id: input.workspaceId,
    contact_id: input.contactId,
    note_text: `[IA → humano] ${reason}. Último mensaje: "${input.messageText.slice(0, 300)}"`,
  } }))
  // Nobody picked yet: round-robin when the workspace enabled it.
  if (!assigneeUserId) await autoAssignConversation(input.workspaceId, input.conversationId, 'ai_handover')
}

function isClosedNow(ctx: BusinessContext): boolean {
  const now = zonedNow(ctx.timeZone)
  const windows = businessWindows(now.date, ctx.hours, ctx.exceptions)
  const m = toMinutes(now.time) ?? 0
  return !windows || !windows.some((w) => m >= w.start && m < w.end)
}

async function history(workspaceId: string, conversationId: string, locale: 'es' | 'en' = 'es'): Promise<ChatTurn[]> {
  const data = await tenantDb(workspaceId)
    .messages.findMany({
      select: { sender_type: true, content_text: true, content_type: true, transcript: true, ai_media_text: true, created_at: true },
      where: {
        conversation_id: conversationId,
        content_type: { not: 'system' },
        // Team-only notes never reach the model.
        is_internal: { not: true },
      },
      orderBy: { created_at: 'desc' },
      take: HISTORY_TURNS,
    })
    .catch(() => [])
  const turns: ChatTurn[] = []
  for (const m of data.reverse()) {
    // Voice notes read as their transcript, images/PDFs as "[Imagen: …]" (AI assist).
    const content = messageTextForAi(m, locale)
    const role: ChatTurn['role'] = m.sender_type === 'customer' ? 'user' : 'assistant'
    const last = turns[turns.length - 1]
    // Providers want alternating roles: merge consecutive same-role turns.
    if (last && last.role === role) last.content += `\n${content}`
    else turns.push({ role, content })
  }
  while (turns.length && turns[0].role !== 'user') turns.shift()
  return asJsonHistory(turns)
}

/**
 * Past assistant turns are sent in the same JSON shape the model must
 * answer with. With plain-text history some models (DeepSeek) drift into
 * prose or return empty JSON-mode output after a few exchanges.
 */
export function asJsonHistory(turns: ChatTurn[]): ChatTurn[] {
  return turns.map((t) => {
    if (t.role !== 'assistant' || t.content.trimStart().startsWith('{')) return t
    return { role: 'assistant', content: JSON.stringify({ reply: t.content }) }
  })
}

/** Last resort when the model answered prose instead of JSON: use it as the reply. */
export function salvageProse(raw: string): AgentOutput | null {
  const text = raw.trim().replace(/^```\w*\s*|```$/g, '').trim()
  if (!text || text.startsWith('{') || text.length > 2000) return null
  return {
    reply: text,
    intent: 'other',
    language: '',
    confidence: 0.5,
    handover: false,
    transfer_to_agent_id: '',
    booking_action: 'none',
    booking: {},
  }
}

function mergeDraft(prev: BookingDraft | undefined, out: AgentOutput['booking']): BookingDraft {
  const next: BookingDraft = { ...(prev ?? {}) }
  if (!out) return next
  for (const k of ['service_id', 'staff_id', 'product_id', 'date', 'time', 'customer_name'] as const) {
    const v = out[k]
    if (typeof v === 'string' && v.trim() && v.toLowerCase() !== 'any') next[k] = v.trim()
  }
  if (typeof out.party_size === 'number' && out.party_size > 0) next.party_size = Math.round(out.party_size)
  if (out.fields?.length) {
    next.fields = { ...(next.fields ?? {}) }
    for (const f of out.fields) if (f?.key && f.value !== undefined && f.value !== '') next.fields[f.key] = f.value
  }
  return next
}

function transferTargets(agent: AiAgentRow, ctx: BusinessContext): AiAgentRow[] {
  const others = ctx.agents.filter((a) => a.id !== agent.id && a.enabled)
  if (agent.transfer_agent_ids?.length) return others.filter((a) => agent.transfer_agent_ids.includes(a.id))
  return agent.skills.includes('router') ? others.filter((a) => !a.skills.includes('router')) : []
}

/**
 * One agent turn for an inbound customer message. Returns true when the
 * agent handled it (replied, booked, transferred or handed over), false
 * when the caller should fall through (no AI provider, etc.).
 */
export async function runAgent(input: RunAgentInput): Promise<boolean> {
  const { agent } = input
  const ctx = await loadBusinessContext(input.workspaceId)
  if (!ctx) return false
  const db = tenantDb(input.workspaceId)
  const text = input.messageText.trim()
  const lower = text.toLowerCase()

  // 1) Explicit request for a human.
  if (agent.skills.includes('handover') && agent.escalation_keywords?.some((k) => k && new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(lower))) {
    const lang = pickLang(agent, ctx, null)
    await reply(input, agent, TEXT[lang].handover)
    await handOverToHuman(input, 'El cliente pidió hablar con una persona')
    await log(input, agent, TEXT[lang].handover, 'handover', 1)
    return true
  }

  // 2) Outside business hours (only for agents restricted to them).
  if (agent.business_hours_only && isClosedNow(ctx)) {
    if (agent.after_hours_message) {
      await reply(input, agent, agent.after_hours_message)
      await log(input, agent, agent.after_hours_message, 'after_hours', 1)
      return true
    }
    return false
  }

  // 3) Greeting on the first message of a conversation.
  const pureGreeting = /^(hola|buen[oa]s?( d[ií]as| tardes| noches)?|hey|hi|hello|good (morning|afternoon|evening)|qu[eé] tal)[\s!.¡,]*$/i.test(text)
  if (input.isFirstInboundMessage && agent.greeting_message) {
    await reply(input, agent, agent.greeting_message.replace(/\{business\}/gi, ctx.workspace.name))
    if (pureGreeting) {
      await log(input, agent, agent.greeting_message, 'greeting', 1)
      return true
    }
  }

  if (!(await llmConfigured())) {
    console.warn('[ai] no LLM provider configured; agent cannot answer')
    return input.isFirstInboundMessage && !!agent.greeting_message
  }

  // Prepaid credits: one per model turn (a transfer reuses the same turn).
  // Out of credits → the conversation stays with the team.
  if (!input.depth && !(await canSpend(input.workspaceId, 'reply'))) {
    console.warn('[ai] workspace out of AI credits; leaving the message to the team')
    return input.isFirstInboundMessage && !!agent.greeting_message
  }

  // 4) Model turn.
  const conv = await db.conversations
    .findFirst({ select: { ai_state: true, contacts: { select: { name: true } } }, where: { id: input.conversationId } })
    .catch(() => null)
  const state = (conv?.ai_state ?? {}) as ConversationAiState
  const contactName = (conv?.contacts as { name?: string | null } | null | undefined)?.name ?? null

  const upcoming = await db.bookings
    .findMany({
      select: { id: true, booking_date: true, booking_time: true, services: { select: { name: true } }, staff: { select: { name: true } } },
      where: {
        workspace_id: input.workspaceId,
        contact_id: input.contactId,
        status: { in: ['pending', 'confirmed'] },
        booking_date: { gte: zonedNow(ctx.timeZone).date },
      },
      orderBy: { booking_date: 'asc' },
      take: 5,
    })
    .catch(() => null)

  const targets = transferTargets(agent, ctx)
  const sells = agent.skills.includes('orders') && ordersEnabled(ctx.workspace)
  const openCart = sells ? await getOpenCart(input.workspaceId, input.conversationId, input.contactId, false) : null
  const openLines = openCart ? await cartItems(openCart.id, input.workspaceId) : []
  // Real estate: what we know about the buyer/tenant so far.
  const leadAgent = qualifiesLeads(ctx.workspace.industry, agent.skills)
  const leadProfile = leadAgent ? await leadForPrompt(input.workspaceId, input.contactId) : null
  const promptInput = {
    leadProfile,
    cart: openCart
      ? { lines: openLines, subtotal: openLines.reduce((a, l) => a + l.unitPrice * l.quantity, 0) }
      : null,
    ctx,
    agent,
    transferTargets: targets,
    draft: state.booking ?? null,
    customerBookings: (upcoming ?? []).map((b) => ({
      id: b.id,
      booking_date: b.booking_date,
      booking_time: b.booking_time,
      service_name: (b.services as { name?: string } | null)?.name ?? null,
      staff_name: (b.staff as unknown as { name?: string } | null)?.name ?? null,
    })),
    customerName: contactName,
    channelLabel: CHANNEL_LABEL[input.channel.type] ?? input.channel.type,
    calendlySlots: await calendlySlotsFor(ctx, state.booking ?? null),
  }

  const turns = await history(input.workspaceId, input.conversationId, ctx.workspace.locale === 'en' ? 'en' : 'es')
  if (!turns.length || turns[turns.length - 1].role !== 'user') turns.push({ role: 'user', content: text || '[attachment]' })

  const meter = { workspaceId: input.workspaceId, purpose: 'reply', aiAgentId: agent.id, conversationId: input.conversationId, channelId: input.channel.id }
  const ask = async (catalogResults?: Parameters<typeof buildSystemPrompt>[0]['catalogResults']) => {
    const raw = await completeJson({
      system: buildSystemPrompt({ ...promptInput, catalogResults }),
      turns,
      schema: agentOutputSchema(ctx.workspace.industry, agent.skills),
      model: agent.model,
      meter: catalogResults ? { ...meter, purpose: 'catalog' } : meter,
    })
    const parsed = parseJsonLoose<AgentOutput>(raw)
    if (parsed || retried) {
      if (parsed) return parsed
      console.warn('[ai] unparseable model output:', raw.slice(0, 2000))
      return salvageProse(raw)
    }
    console.warn('[ai] unparseable model output, retrying once:', raw.slice(0, 500))
    retried = true
    return ask(catalogResults)
  }
  let retried = false

  let out: AgentOutput | null = null
  try {
    out = await ask()
    if (process.env.AI_DEBUG) console.log('[ai] catalog in context:', ctx.catalog.total, 'small list:', ctx.catalog.products?.length ?? null, 'skills:', agent.skills.join(','))
    if (process.env.AI_DEBUG) console.log('[ai] model output:', JSON.stringify(out))
    // Large catalogs: the model asks for a search, then answers with results.
    if (out?.catalog_search && hasCatalogQuery(out.catalog_search)) {
      const q = toCatalogQuery(out.catalog_search)
      const products = await searchProducts(input.workspaceId, q)
      out = (await ask({ query: describeQuery(out.catalog_search), products })) ?? out
      if (process.env.AI_DEBUG) console.log('[ai] model output after catalog search:', JSON.stringify(out))
    }
  } catch (err) {
    console.error('[ai] completion failed:', err)
  }
  if (!out || typeof out.reply !== 'string') {
    if (!agent.skills.includes('handover')) return false
    const lang = pickLang(agent, ctx, null)
    await reply(input, agent, TEXT[lang].fallback)
    await handOverToHuman(input, 'La IA no pudo procesar el mensaje')
    return true
  }
  if (!input.depth) await spend(input.workspaceId, 'reply', { conversationId: input.conversationId })

  // Real estate: merge what the customer told us (lead profile → score,
  // deal stage, routing) and register owners offering their property.
  if (leadAgent) {
    await applyAiLeadProfile({ workspaceId: input.workspaceId, contactId: input.contactId, conversationId: input.conversationId, raw: out.lead_profile })
    if (out.capture) {
      await applyAiCapture({ workspaceId: input.workspaceId, contactId: input.contactId, conversationId: input.conversationId, capture: out.capture, state })
    }
  }

  const lang = pickLang(agent, ctx, out.language)
  const T = TEXT[lang]
  const bookingNoun = industryLabel(ctx.workspace.industry, 'booking', lang, ctx.workspace.settings).toLowerCase()

  // 5) Transfer to another agent: it answers the same message right away.
  const target = out.transfer_to_agent_id ? targets.find((a) => a.id === out!.transfer_to_agent_id) : undefined
  if (target && (input.depth ?? 0) < 1) {
    await setState(input.workspaceId, input.conversationId, { ai_agent_id: target.id })
    await quiet(db.messages.create({ data: {
      workspace_id: input.workspaceId,
      conversation_id: input.conversationId,
      sender_type: 'bot',
      ai_agent_id: agent.id,
      content_type: 'system',
      content_text: `${agent.name} → ${target.name}`,
      status: 'delivered',
      metadata: { event: 'agent_transfer', from: agent.id, to: target.id },
    } }))
    await log(input, agent, out.reply, 'transfer', out.confidence ?? 1)
    const handled = await runAgent({ ...input, agent: target, isFirstInboundMessage: false, depth: (input.depth ?? 0) + 1 })
    if (!handled && out.reply.trim()) await reply(input, agent, out.reply)
    return true
  }

  // 6) Handover / emergency.
  if (out.handover || out.intent === 'emergency') {
    await reply(input, agent, out.reply?.trim() || T.handover)
    await handOverToHuman(input, out.intent === 'emergency' ? 'Posible emergencia' : 'La IA pasó la conversación a una persona')
    await log(input, agent, out.reply, out.intent, out.confidence ?? 0)
    return true
  }

  // 7) Bookings.
  if (out.booking_action === 'collecting' || out.booking_action === 'confirm' || out.booking_action === 'cancel') {
    const draft = resolveDraftIds(mergeDraft(state.booking, out.booking), ctx)
    if (!draft.customer_name && contactName && !/^\+?\d+$/.test(contactName)) draft.customer_name = contactName

    // The model sometimes summarizes and forgets to flag the confirmation:
    // a clear "yes" to a complete booking is a confirmation.
    if (out.booking_action === 'collecting' && isAffirmative(text) && state.booking && bookingLooksComplete(draft, ctx)) {
      out.booking_action = 'confirm'
    }

    if (out.booking_action === 'cancel') {
      const cancelled = await cancelNextBooking(input.workspaceId, input.contactId, draft)
      const msg = cancelled ? fill(T.cancelled, { booking: bookingNoun, date: longDate(cancelled.date, lang, ctx), time: cancelled.time }) : T.noBooking
      await setState(input.workspaceId, input.conversationId, { ai_state: { ...state, booking: undefined } })
      await reply(input, agent, msg)
      await log(input, agent, msg, 'cancel_booking', out.confidence ?? 1)
      return true
    }

    if (out.booking_action === 'confirm') {
      // Bookings about a product (property viewing): if the model didn't
      // say which, use the product most recently shown in this chat.
      if (!draft.product_id && getPreset(ctx.workspace.industry).bookingFields.some((f) => f.type === 'product')) {
        draft.product_id = await lastShownProductId(input.workspaceId, input.conversationId)
      }
      const result = await createBookingFromDraft({
        workspaceId: input.workspaceId,
        contactId: input.contactId,
        conversationId: input.conversationId,
        aiAgentId: agent.id,
        draft,
        source: 'ai',
      })
      if (result.ok) {
        const extra = [result.serviceName ? fill(T.for, { service: result.serviceName }) : '', result.staffName ? fill(T.with, { staff: result.staffName }) : ''].join('')
        const msg = fill(T.booked, { booking: bookingNoun, date: longDate(draft.date!, lang, ctx), time: draft.time!.padStart(5, '0'), extra })
        await setState(input.workspaceId, input.conversationId, { ai_state: { ...state, booking: undefined } })
        await reply(input, agent, msg)
        // Viewing of a listing: deal → "Visita agendada" + map pin.
        if (draft.product_id) await onViewingConfirmed(input.workspaceId, result.bookingId, { sendLocation: true, aiAgentId: agent.id })
        await log(input, agent, msg, 'booking', out.confidence ?? 1)
        return true
      }
      // Not bookable: keep what we know (minus the bad time) and explain.
      // Never forward the model's text here: it may claim the booking is done.
      if (result.reason === 'link') {
        const msg = fill(T.bookingLink, { booking: bookingNoun, date: longDate(draft.date!, lang, ctx), time: draft.time!.padStart(5, '0'), url: result.url })
        await setState(input.workspaceId, input.conversationId, { ai_state: { ...state, booking: undefined } })
        await reply(input, agent, msg)
        await log(input, agent, msg, 'booking', out.confidence ?? 1)
        return true
      }
      let msg = fill(T.notConfirmed, { booking: bookingNoun })
      if (result.reason === 'slot_taken') msg = fill(T.slotTaken, { alts: result.alternatives.join(', ') })
      else if (result.reason === 'closed') msg = T.closed
      else if (result.reason === 'past') msg = T.past
      else if (result.reason === 'missing') msg = fill(T.missing, { booking: bookingNoun, fields: describeMissing(result.missing, lang, ctx) })
      if (process.env.AI_DEBUG) console.log('[ai] booking not created:', JSON.stringify(result), JSON.stringify(draft))
      const kept = { ...draft, ...(result.reason === 'missing' ? {} : { time: null }) }
      await setState(input.workspaceId, input.conversationId, { ai_state: { ...state, booking: kept } })
      await reply(input, agent, msg)
      await log(input, agent, msg, 'booking', out.confidence ?? 0)
      return true
    }

    await setState(input.workspaceId, input.conversationId, { ai_state: { ...state, booking: draft } })
  }

  // 8) Plain answer, then what the model asked the system to do:
  //    cart changes, product carousel/photos, cart summary or checkout.
  if (out.reply?.trim()) await reply(input, agent, out.reply, false)
  const commerce: CommerceCtx = {
    workspace: ctx.workspace,
    channel: input.channel,
    conversationId: input.conversationId,
    contactId: input.contactId,
    aiAgentId: agent.id,
  }
  if (sells && out.cart_ops?.length) await applyCartOps(commerce, out.cart_ops)
  // Carousel with action buttons when the business sells from chat or
  // books visits per product (real estate); otherwise plain photo cards.
  const cardsWithActions = sells || productAction(ctx.workspace) === 'book'
  if (cardsWithActions && out.show_product_ids?.length) {
    const shown = await sendProductCarousel(commerce, out.show_product_ids)
    if (!shown) await sendProductCards(input, agent, ctx, out.show_product_ids)
  } else {
    await sendProductCards(input, agent, ctx, out.show_product_ids)
  }
  if (sells && out.order_action === 'checkout') await startCheckout(commerce)
  else if (sells && (out.order_action === 'show_cart' || out.cart_ops?.length)) {
    await sendCartSummary(commerce, await getOpenCart(input.workspaceId, input.conversationId, input.contactId, false))
  }
  await log(input, agent, out.reply, out.intent ?? 'other', out.confidence ?? 0)
  return true
}

const UUID_ANY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Executes the model's cart changes; problems (stock, price) are told to the customer. */
async function applyCartOps(c: CommerceCtx, ops: NonNullable<AgentOutput['cart_ops']>) {
  const cart = await getOpenCart(c.workspace.id, c.conversationId, c.contactId, true)
  if (!cart) return
  const db = tenantDb(c.workspace.id)
  const problems: string[] = []
  for (const op of ops.slice(0, 10)) {
    if (!op?.product_id || !UUID_ANY.test(op.product_id)) continue
    let variantId: string | null = null
    if (op.variant_name?.trim()) {
      const variants = await db.product_variants.findMany({ select: { id: true, name: true }, where: { product_id: op.product_id, is_active: true } }).catch(() => null)
      const want = norm(op.variant_name)
      variantId = variants?.find((v) => norm(v.name) === want)?.id ?? variants?.find((v) => norm(v.name).includes(want))?.id ?? null
    }
    const qty = Math.max(0, Math.round(Number(op.quantity ?? 1)))
    if (op.op === 'remove' || (op.op === 'set' && qty === 0)) {
      await setLineQuantity(cart, op.product_id, variantId, 0)
    } else if (op.op === 'set') {
      await setLineQuantity(cart, op.product_id, variantId, qty)
    } else {
      const r = await addToCart(cart, op.product_id, variantId, qty || 1)
      if (!r.ok) {
        const lang = c.workspace.locale === 'en' ? 'en' : 'es'
        problems.push(
          r.reason === 'out_of_stock'
            ? `${r.name}: ${lang === 'en' ? 'out of stock' : 'agotado'}`
            : r.reason === 'not_enough'
              ? `${r.name}: ${lang === 'en' ? `only ${r.available} left` : `solo quedan ${r.available}`}`
              : r.reason === 'price_on_request'
                ? `${r.name}: ${lang === 'en' ? 'price on request' : 'precio a consultar'}`
                : r.reason === 'foreign_currency'
                ? fill(texts(lang).foreignCurrency, { name: r.name, currency: r.currency })
                : lang === 'en' ? 'a product is no longer available' : 'un producto ya no está disponible',
        )
      }
    }
  }
  if (problems.length) {
    await sendMessage({
      workspaceId: c.workspace.id,
      conversationId: c.conversationId,
      content: { type: 'text', text: `⚠️ ${problems.join(' · ')}` },
      sender: { type: 'bot', aiAgentId: c.aiAgentId ?? null },
    })
  }
}

// \b doesn't work after accented letters ("sí"), so end on space/punctuation.
const AFFIRMATIVE = /^(s[ií]|si+|claro|ok(ay)?|dale|listo|confirmo|confirmado|perfecto|de acuerdo|va|correcto|yes|yep|sure|confirm(ed)?)(?=$|[\s,.;:!?¡¿])/i

export function isAffirmative(text: string): boolean {
  return AFFIRMATIVE.test(text.trim().replace(/^[¡!.,\s]+/, ''))
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()

/** Models sometimes return names instead of ids: map them back. */
export function resolveDraftIds(draft: BookingDraft, ctx: Pick<BusinessContext, 'services' | 'staff'>): BookingDraft {
  const out = { ...draft }
  const pick = <T extends { id: string; name: string }>(value: string | null | undefined, list: T[]) => {
    if (!value) return value
    if (UUID_RE.test(value)) return list.some((x) => x.id === value) ? value : null
    const v = norm(value)
    return (list.find((x) => norm(x.name) === v) ?? list.find((x) => norm(x.name).includes(v) || v.includes(norm(x.name))))?.id ?? null
  }
  out.service_id = pick(draft.service_id, ctx.services) ?? null
  out.staff_id = pick(draft.staff_id, ctx.staff) ?? null
  if (out.time) {
    const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?$/i.exec(out.time.trim())
    if (m) {
      let h = Number(m[1])
      const pm = m[3]?.toLowerCase().startsWith('p')
      if (pm && h < 12) h += 12
      if (m[3] && !pm && h === 12) h = 0
      out.time = `${String(h).padStart(2, '0')}:${m[2] ?? '00'}`
    }
  }
  return out
}

/** "jueves 8 de octubre" / "Thursday, October 8" for a YYYY-MM-DD date. */
export function longDate(date: string, lang: Lang, ctx: Pick<BusinessContext, 'workspace'>): string {
  const [y, m, d] = date.split('-').map(Number)
  if (!y || !m || !d) return date
  const locale = lang === 'en' ? 'en-US' : `es-${ctx.workspace.country || 'MX'}`
  try {
    return new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)))
  } catch {
    return date
  }
}

function bookingLooksComplete(draft: BookingDraft, ctx: BusinessContext): boolean {
  return !!(draft.date && draft.time && (ctx.services.length === 0 || draft.service_id))
}

/** Product the bot showed last in this conversation (photo card or carousel). */
async function lastShownProductId(workspaceId: string, conversationId: string): Promise<string | null> {
  const data = await tenantDb(workspaceId)
    .messages.findMany({ select: { metadata: true }, where: { conversation_id: conversationId, sender_type: 'bot' }, orderBy: { created_at: 'desc' }, take: 15 })
    .catch(() => [])
  for (const row of data) {
    const md = (row.metadata ?? {}) as { product_id?: string; product_ids?: string[] }
    if (md.product_id) return md.product_id
    if (md.product_ids?.length === 1) return md.product_ids[0]
  }
  return null
}

/** Calendly free times of the draft's service, when it is booked there (errors → no times). */
async function calendlySlotsFor(ctx: BusinessContext, draft: BookingDraft | null): Promise<Record<string, string[]> | null> {
  const link = draft?.service_id ? ctx.calendly?.[draft.service_id] : undefined
  if (!link) return null
  try {
    return await calendlySlotsForPrompt(link, ctx.timeZone, isIsoDate(draft?.date) ? draft!.date! : null)
  } catch (err) {
    console.warn('[ai] calendly availability unavailable:', err instanceof Error ? err.message : err)
    return {}
  }
}

function describeMissing(missing: string[], lang: Lang, ctx: BusinessContext): string {
  const es: Record<string, string> = { service: 'el servicio', staff: industryLabel(ctx.workspace.industry, 'staff', 'es', ctx.workspace.settings).toLowerCase(), date: 'la fecha', time: 'la hora', customer_name: 'el nombre completo', email: 'tu correo electrónico', party_size: 'el número de personas', product: `qué ${industryLabel(ctx.workspace.industry, 'product', 'es', ctx.workspace.settings).toLowerCase()} es` }
  const en: Record<string, string> = { service: 'the service', staff: industryLabel(ctx.workspace.industry, 'staff', 'en', ctx.workspace.settings).toLowerCase(), date: 'the date', time: 'the time', customer_name: 'your name', email: 'your email', party_size: 'the number of people', product: 'which one you want' }
  const dict = lang === 'en' ? en : es
  return missing.map((m) => dict[m] ?? m).join(', ')
}

function hasCatalogQuery(q: NonNullable<AgentOutput['catalog_search']>): boolean {
  return !!(q.text?.trim() || q.category_id || q.filters?.length || q.min_price || q.max_price)
}

export function toCatalogQuery(q: NonNullable<AgentOutput['catalog_search']>): CatalogQuery {
  const filters: Record<string, unknown> = {}
  for (const f of q.filters ?? []) {
    if (!f?.key || f.value === undefined || f.value === '') continue
    const key = f.key.trim().toLowerCase()
    const num = Number(f.value)
    filters[key] = /__(min|max)$/.test(key) && Number.isFinite(num) ? num : f.value
  }
  return {
    text: q.text ?? null,
    categoryId: q.category_id && /^[0-9a-f-]{36}$/i.test(q.category_id) ? q.category_id : null,
    filters,
    minPrice: typeof q.min_price === 'number' && q.min_price > 0 ? q.min_price : null,
    maxPrice: typeof q.max_price === 'number' && q.max_price > 0 ? q.max_price : null,
    priceCurrency: parseCurrency(q.currency),
    limit: 8,
  }
}

function describeQuery(q: NonNullable<AgentOutput['catalog_search']>): string {
  return [q.text, ...(q.filters ?? []).map((f) => `${f.key}=${f.value}`), q.min_price ? `>=${q.min_price}` : '', q.max_price ? `<=${q.max_price}` : '', (q.min_price || q.max_price) && q.currency ? String(q.currency).toUpperCase() : '']
    .filter(Boolean)
    .join(', ')
}

/** Sends up to 3 product photos with name and price as caption. */
async function sendProductCards(input: RunAgentInput, agent: AiAgentRow, ctx: BusinessContext, ids: string[] | undefined) {
  const wanted = (ids ?? []).filter((id) => /^[0-9a-f-]{36}$/i.test(id)).slice(0, 3)
  if (!wanted.length) return
  const products = await getProducts(input.workspaceId, wanted)
  for (const p of products) {
    if (!p.images?.[0]) continue
    const price = p.price === null ? '' : ` — ${formatProductPrice(Number(p.price), p, ctx.workspace)}`
    await sendMessage({
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      content: { type: 'media', mediaType: 'image', url: p.images[0], caption: `*${p.name}*${price}` },
      sender: { type: 'bot', aiAgentId: agent.id },
      metadata: { product_id: p.id },
    })
  }
}

export interface PreviewTurnInput {
  workspaceId: string
  agent: AiAgentRow
  turns: ChatTurn[]
  draft?: BookingDraft | null
  channelType?: string
}

export interface PreviewTurnResult {
  reply: string
  intent: string
  handover: boolean
  transferTo: { id: string; name: string } | null
  bookingAction: string
  draft: BookingDraft
  /** Catalog search the agent ran before answering, if any. */
  catalogSearch: string | null
  showProductIds: string[]
}

/**
 * Playground: one model turn with the real prompt and business data but
 * no side effects (nothing is sent, booked or stored).
 */
export async function previewAgentTurn(input: PreviewTurnInput): Promise<PreviewTurnResult> {
  const ctx = await loadBusinessContext(input.workspaceId, true)
  if (!ctx) throw new Error('Workspace not found')
  const targets = transferTargets(input.agent, ctx)
  const promptBase = {
    ctx,
    agent: input.agent,
    transferTargets: targets,
    draft: input.draft ?? null,
    customerBookings: [],
    customerName: null,
    channelLabel: CHANNEL_LABEL[input.channelType ?? 'webchat'] ?? 'chat',
    calendlySlots: await calendlySlotsFor(ctx, input.draft ?? null),
  }
  const system = buildSystemPrompt(promptBase)
  const ask = async (catalogResults?: Parameters<typeof buildSystemPrompt>[0]['catalogResults']) =>
    parseJsonLoose<AgentOutput>(
      await completeJson({
        system: catalogResults ? buildSystemPrompt({ ...promptBase, catalogResults }) : system,
        turns: asJsonHistory(input.turns),
        schema: agentOutputSchema(ctx.workspace.industry, input.agent.skills),
        model: input.agent.model,
        meter: { workspaceId: input.workspaceId, purpose: 'playground', aiAgentId: input.agent.id },
      }),
    )
  let out = await ask()
  let searched: string | null = null
  if (out?.catalog_search && hasCatalogQuery(out.catalog_search)) {
    searched = describeQuery(out.catalog_search)
    const products = await searchProducts(input.workspaceId, toCatalogQuery(out.catalog_search))
    out = (await ask({ query: searched, products })) ?? out
  }
  if (!out) throw new Error('The model returned an unreadable answer')
  const target = out.transfer_to_agent_id ? targets.find((a) => a.id === out.transfer_to_agent_id) : undefined
  return {
    reply: out.reply ?? '',
    intent: out.intent ?? 'other',
    handover: !!out.handover,
    transferTo: target ? { id: target.id, name: target.name } : null,
    bookingAction: out.booking_action ?? 'none',
    draft: mergeDraft(input.draft ?? undefined, out.booking),
    catalogSearch: searched,
    showProductIds: (out.show_product_ids ?? []).slice(0, 3),
  }
}

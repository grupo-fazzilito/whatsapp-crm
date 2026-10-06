import 'server-only'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { sendMessage } from '@/lib/messaging/send'
import { industryLabel } from '@/lib/industries'
import type { LoadedChannel } from '@/lib/channels'
import { loadBusinessContext, type BusinessContext } from './context'
import { completeJson, llmConfigured, parseJsonLoose, type ChatTurn } from './llm'
import { AGENT_OUTPUT_SCHEMA, buildSystemPrompt, type AgentOutput } from './prompt'
import { cancelNextBooking, createBookingFromDraft } from './bookings'
import { businessWindows } from './slots'
import { toMinutes, zonedNow } from './time'
import type { AiAgentRow, BookingDraft, ConversationAiState } from './types'

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
    handover: 'Gracias por escribir. Te comunico con una persona del equipo; en breve te responden. 🙏',
    booked: '✅ ¡Listo! Tu {booking} quedó confirmada para el *{date}* a las *{time}*{extra}.',
    slotTaken: 'Ese horario ya no está disponible. Opciones para ese día: {alts}. ¿Cuál prefieres?',
    closed: 'Ese día no hay disponibilidad. ¿Te propongo otra fecha?',
    past: 'Esa fecha u hora ya pasó. ¿Qué otro día te acomoda?',
    cancelled: 'Tu {booking} del *{date}* a las *{time}* quedó cancelada.',
    noBooking: 'No encontré una reserva próxima a tu nombre. ¿Me compartes la fecha?',
    fallback: 'Disculpa, no pude procesar tu mensaje. Te comunico con una persona del equipo.',
    with: ' con {staff}',
    for: ' para {service}',
  },
  en: {
    handover: 'Thanks for reaching out. I’m connecting you with a team member who will reply shortly. 🙏',
    booked: '✅ Done! Your {booking} is confirmed for *{date}* at *{time}*{extra}.',
    slotTaken: 'That time is no longer available. Options that day: {alts}. Which one works for you?',
    closed: 'There’s no availability that day. Shall I suggest another date?',
    past: 'That date or time has already passed. What other day works for you?',
    cancelled: 'Your {booking} on *{date}* at *{time}* has been cancelled.',
    noBooking: 'I couldn’t find an upcoming booking under your name. Could you share the date?',
    fallback: 'Sorry, I couldn’t process your message. I’m connecting you with a team member.',
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

async function reply(input: RunAgentInput, agent: AiAgentRow, text: string, quote = false) {
  const db = supabaseAdmin()
  let replyToMessageId: string | null = null
  if (quote && input.contextMessageId) {
    const { data } = await db
      .from('messages')
      .select('id')
      .eq('conversation_id', input.conversationId)
      .eq('message_id', input.contextMessageId)
      .maybeSingle()
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
  await supabaseAdmin().from('ai_chat_logs').insert({
    workspace_id: input.workspaceId,
    contact_id: input.contactId,
    conversation_id: input.conversationId,
    channel_id: input.channel.id,
    ai_agent_id: agent.id,
    user_message: input.messageText,
    ai_response: response,
    detected_intent: intent,
    confidence_score: Math.max(0, Math.min(1, confidence)),
  })
}

async function setState(conversationId: string, patch: Record<string, unknown>) {
  await supabaseAdmin().from('conversations').update(patch).eq('id', conversationId)
}

/** Pass to humans: pause the AI, flag the conversation, leave a note. */
export async function handOverToHuman(
  input: Pick<RunAgentInput, 'workspaceId' | 'contactId' | 'conversationId' | 'messageText'>,
  reason: string,
  assigneeUserId?: string | null,
) {
  const db = supabaseAdmin()
  const { data: conv } = await db.from('conversations').select('unread_count').eq('id', input.conversationId).maybeSingle()
  await setState(input.conversationId, {
    status: 'open',
    ai_paused_until: new Date(Date.now() + HANDOVER_PAUSE_MS).toISOString(),
    unread_count: Math.max(1, conv?.unread_count ?? 0),
    ...(assigneeUserId ? { assigned_agent_id: assigneeUserId } : {}),
  })
  await db.from('contact_notes').insert({
    workspace_id: input.workspaceId,
    contact_id: input.contactId,
    note_text: `[IA → humano] ${reason}. Último mensaje: "${input.messageText.slice(0, 300)}"`,
  })
}

function isClosedNow(ctx: BusinessContext): boolean {
  const now = zonedNow(ctx.timeZone)
  const windows = businessWindows(now.date, ctx.hours, ctx.exceptions)
  const m = toMinutes(now.time) ?? 0
  return !windows || !windows.some((w) => m >= w.start && m < w.end)
}

async function history(conversationId: string): Promise<ChatTurn[]> {
  const { data } = await supabaseAdmin()
    .from('messages')
    .select('sender_type, content_text, content_type, created_at')
    .eq('conversation_id', conversationId)
    .neq('content_type', 'system')
    .order('created_at', { ascending: false })
    .limit(HISTORY_TURNS)
  const turns: ChatTurn[] = []
  for (const m of (data ?? []).reverse()) {
    const content = (m.content_text ?? '').trim() || `[${m.content_type}]`
    const role: ChatTurn['role'] = m.sender_type === 'customer' ? 'user' : 'assistant'
    const last = turns[turns.length - 1]
    // Providers want alternating roles: merge consecutive same-role turns.
    if (last && last.role === role) last.content += `\n${content}`
    else turns.push({ role, content })
  }
  while (turns.length && turns[0].role !== 'user') turns.shift()
  return turns
}

function mergeDraft(prev: BookingDraft | undefined, out: AgentOutput['booking']): BookingDraft {
  const next: BookingDraft = { ...(prev ?? {}) }
  if (!out) return next
  for (const k of ['service_id', 'staff_id', 'date', 'time', 'customer_name'] as const) {
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
  const db = supabaseAdmin()
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

  // 4) Model turn.
  const { data: conv } = await db
    .from('conversations')
    .select('ai_state, contact:contacts(name)')
    .eq('id', input.conversationId)
    .maybeSingle()
  const state = (conv?.ai_state ?? {}) as ConversationAiState
  const contactName = (conv?.contact as unknown as { name?: string } | null)?.name ?? null

  const { data: upcoming } = await db
    .from('bookings')
    .select('id, booking_date, booking_time, service:services(name), staff:staff(name)')
    .eq('workspace_id', input.workspaceId)
    .eq('contact_id', input.contactId)
    .in('status', ['pending', 'confirmed'])
    .gte('booking_date', zonedNow(ctx.timeZone).date)
    .order('booking_date')
    .limit(5)

  const targets = transferTargets(agent, ctx)
  const system = buildSystemPrompt({
    ctx,
    agent,
    transferTargets: targets,
    draft: state.booking ?? null,
    customerBookings: (upcoming ?? []).map((b) => ({
      id: b.id,
      booking_date: b.booking_date,
      booking_time: b.booking_time,
      service_name: (b.service as unknown as { name?: string } | null)?.name ?? null,
      staff_name: (b.staff as unknown as { name?: string } | null)?.name ?? null,
    })),
    customerName: contactName,
    channelLabel: CHANNEL_LABEL[input.channel.type] ?? input.channel.type,
  })

  const turns = await history(input.conversationId)
  if (!turns.length || turns[turns.length - 1].role !== 'user') turns.push({ role: 'user', content: text || '[attachment]' })

  let out: AgentOutput | null = null
  try {
    out = parseJsonLoose<AgentOutput>(await completeJson({ system, turns, schema: AGENT_OUTPUT_SCHEMA as unknown as Record<string, unknown>, model: agent.model }))
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

  const lang = pickLang(agent, ctx, out.language)
  const T = TEXT[lang]
  const bookingNoun = industryLabel(ctx.workspace.industry, 'booking', lang, ctx.workspace.settings).toLowerCase()

  // 5) Transfer to another agent: it answers the same message right away.
  const target = out.transfer_to_agent_id ? targets.find((a) => a.id === out!.transfer_to_agent_id) : undefined
  if (target && (input.depth ?? 0) < 1) {
    await setState(input.conversationId, { ai_agent_id: target.id })
    await db.from('messages').insert({
      workspace_id: input.workspaceId,
      conversation_id: input.conversationId,
      sender_type: 'bot',
      ai_agent_id: agent.id,
      content_type: 'system',
      content_text: `${agent.name} → ${target.name}`,
      status: 'delivered',
      metadata: { event: 'agent_transfer', from: agent.id, to: target.id },
    })
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
    const draft = mergeDraft(state.booking, out.booking)
    if (!draft.customer_name && contactName && !/^\+?\d+$/.test(contactName)) draft.customer_name = contactName

    if (out.booking_action === 'cancel') {
      const cancelled = await cancelNextBooking(input.workspaceId, input.contactId, draft)
      const msg = cancelled ? fill(T.cancelled, { booking: bookingNoun, date: cancelled.date, time: cancelled.time }) : T.noBooking
      await setState(input.conversationId, { ai_state: { ...state, booking: undefined } })
      await reply(input, agent, msg)
      await log(input, agent, msg, 'cancel_booking', out.confidence ?? 1)
      return true
    }

    if (out.booking_action === 'confirm') {
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
        const msg = fill(T.booked, { booking: bookingNoun, date: draft.date!, time: draft.time!.padStart(5, '0'), extra })
        await setState(input.conversationId, { ai_state: { ...state, booking: undefined } })
        await reply(input, agent, msg)
        await log(input, agent, msg, 'booking', out.confidence ?? 1)
        return true
      }
      // Not bookable: keep what we know (minus the bad time) and explain.
      let msg = out.reply
      if (result.reason === 'slot_taken') msg = fill(T.slotTaken, { alts: result.alternatives.join(', ') })
      else if (result.reason === 'closed') msg = T.closed
      else if (result.reason === 'past') msg = T.past
      const kept = { ...draft, ...(result.reason === 'missing' ? {} : { time: null }) }
      await setState(input.conversationId, { ai_state: { ...state, booking: kept } })
      await reply(input, agent, msg)
      await log(input, agent, msg, 'booking', out.confidence ?? 0)
      return true
    }

    await setState(input.conversationId, { ai_state: { ...state, booking: draft } })
  }

  // 8) Plain answer.
  await reply(input, agent, out.reply, false)
  await log(input, agent, out.reply, out.intent ?? 'other', out.confidence ?? 0)
  return true
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
}

/**
 * Playground: one model turn with the real prompt and business data but
 * no side effects (nothing is sent, booked or stored).
 */
export async function previewAgentTurn(input: PreviewTurnInput): Promise<PreviewTurnResult> {
  const ctx = await loadBusinessContext(input.workspaceId, true)
  if (!ctx) throw new Error('Workspace not found')
  const targets = transferTargets(input.agent, ctx)
  const system = buildSystemPrompt({
    ctx,
    agent: input.agent,
    transferTargets: targets,
    draft: input.draft ?? null,
    customerBookings: [],
    customerName: null,
    channelLabel: CHANNEL_LABEL[input.channelType ?? 'webchat'] ?? 'chat',
  })
  const out = parseJsonLoose<AgentOutput>(
    await completeJson({ system, turns: input.turns, schema: AGENT_OUTPUT_SCHEMA as unknown as Record<string, unknown>, model: input.agent.model }),
  )
  if (!out) throw new Error('The model returned an unreadable answer')
  const target = out.transfer_to_agent_id ? targets.find((a) => a.id === out.transfer_to_agent_id) : undefined
  return {
    reply: out.reply ?? '',
    intent: out.intent ?? 'other',
    handover: !!out.handover,
    transferTo: target ? { id: target.id, name: target.name } : null,
    bookingAction: out.booking_action ?? 'none',
    draft: mergeDraft(input.draft ?? undefined, out.booking),
  }
}

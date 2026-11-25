import 'server-only'
import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/db/prisma'
import { tenantDb } from '@/lib/db/tenant'
import type { LoadedChannel } from '@/lib/channels/types'
import { loadBusinessContext, type BusinessContext } from '@/lib/ai/context'
import { availabilityBlock } from '@/lib/ai/prompt'
import { cancelNextBooking, createBookingFromDraft } from '@/lib/ai/bookings'
import { handOverToHuman, longDate, resolveDraftIds } from '@/lib/ai/engine'
import { completeJson, parseJsonLoose } from '@/lib/ai/llm'
import { zonedNow } from '@/lib/ai/time'
import type { AiAgentRow, BookingDraft } from '@/lib/ai/types'
import { searchProducts } from '@/lib/catalog/search'
import { formatProductPrice } from '@/lib/catalog/currency'
import { canSpend, spend } from '@/lib/billing/credits'
import { sendMessage } from '@/lib/messaging/send'
import { callAction } from './meta'
import { billableMinutes, planAnswer, readCallAi, type CallAiConfig } from './ai-config'
import {
  callGreeting,
  callLanguage,
  DEFAULT_REALTIME_MODEL,
  realtimeKey,
  voiceCallbackBase,
  voiceInstructions,
  voiceService,
  voiceTools,
  type CallLang,
} from './ai-session'

// WhatsApp calls answered by an AI agent. Whasalia keeps the call (row,
// Meta's API, tools, billing); the voice service (voice/, Pipecat) only
// carries the audio between WhatsApp's WebRTC and OpenAI Realtime.
//
//   ring ─► planAnswer ─► startAiCall: claim the row, POST {voice}/calls with
//           the offer → SDP answer → Meta pre_accept + accept
//   during the call: POST /api/voice/calls/[id]/tool  (runVoiceTool)
//   voice service ends: POST /api/voice/calls/[id]/end (finishAiCall)
//   Meta's terminate webhook closes the row and bills (billAiCall)

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

async function loadAgent(workspaceId: string, id: string | null): Promise<AiAgentRow | null> {
  if (!id) return null
  const row = await tenantDb(workspaceId).ai_agents.findFirst({ where: { id, enabled: true } })
  return (row as unknown as AiAgentRow) ?? null
}

/** Why the AI can't take calls right now (null = it can). Shown in the channel settings too. */
export type AiCallBlock = 'no_service' | 'no_key' | 'no_agent' | 'no_tokens'

export async function aiCallBlock(workspaceId: string, config: CallAiConfig): Promise<AiCallBlock | null> {
  if (!voiceService() || !voiceCallbackBase()) return 'no_service'
  if (!(await realtimeKey())) return 'no_key'
  if (!(await loadAgent(workspaceId, config.agent_id))) return 'no_agent'
  if (!(await canSpend(workspaceId, 'call_minute'))) return 'no_tokens'
  return null
}

// ---------------------------------------------------------------- ringing

/**
 * Right after the row is created: answer with the AI now, later (nobody
 * answered) or never, per the number's settings.
 */
export async function routeIncomingCall(channel: LoadedChannel, callRowId: string): Promise<void> {
  const config = readCallAi(channel.settings)
  if (config.mode === 'humans' || !config.agent_id) return
  const ctx = await loadBusinessContext(channel.workspace_id)
  if (!ctx) return
  const plan = planAnswer({ config, timeZone: ctx.timeZone, hours: ctx.hours, exceptions: ctx.exceptions })
  if (plan.kind === 'humans') return
  if (plan.kind === 'ai') {
    await startAiCall(channel, callRowId)
    return
  }
  // Rings the team first; the AI takes it if it is still ringing then.
  // The app runs as a long-lived server, so a timer is enough.
  setTimeout(() => {
    void startAiCall(channel, callRowId).catch((err) => console.error('[calls:ai] fallback failed:', message(err)))
  }, plan.afterSeconds * 1000)
}

async function voiceFetch(path: string, init: { method: 'POST' | 'DELETE'; body?: unknown; timeoutMs?: number }) {
  const svc = voiceService()
  if (!svc) throw new Error('voice service not configured')
  const res = await fetch(`${svc.url}${path}`, {
    method: init.method,
    headers: { Authorization: `Bearer ${svc.secret}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(init.timeoutMs ?? 15_000),
    cache: 'no-store',
  })
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : `voice service ${res.status}`)
  return data
}

/** Tells the voice service to drop the call (best effort). */
export async function stopVoiceCall(callRowId: string): Promise<void> {
  if (!voiceService()) return
  await voiceFetch(`/calls/${callRowId}`, { method: 'DELETE', timeoutMs: 5000 }).catch(() => {})
}

/**
 * The AI picks up: claim the ringing row, have the voice service answer
 * WhatsApp's offer, then pre_accept + accept with that answer. If the
 * voice service fails, the call goes back to ringing for the team.
 */
export async function startAiCall(channel: LoadedChannel, callRowId: string): Promise<boolean> {
  const workspaceId = channel.workspace_id
  const db = tenantDb(workspaceId)
  const config = readCallAi(channel.settings)
  const row = await db.whatsapp_calls.findFirst({ where: { id: callRowId } })
  if (!row || row.status !== 'ringing' || !row.sdp_offer) return false

  const block = await aiCallBlock(workspaceId, config)
  if (block) {
    console.warn(`[calls:ai] ${callRowId}: the AI can't answer (${block}); the team gets the call`)
    return false
  }
  const [agent, ctx, key] = await Promise.all([loadAgent(workspaceId, config.agent_id), loadBusinessContext(workspaceId), realtimeKey()])
  if (!agent || !ctx || !key) return false

  const won = await db.whatsapp_calls.updateMany({
    where: { id: row.id, status: 'ringing' },
    data: { status: 'answering', ai_agent_id: agent.id, answered_by: null, updated_at: new Date() },
  })
  if (won.count === 0) return false // someone from the team answered first

  const contact = row.contact_id
    ? await db.contacts.findFirst({ where: { id: row.contact_id }, select: { name: true, phone: true } })
    : null
  const today = zonedNow(ctx.timeZone).date
  const upcoming = row.contact_id
    ? await db.bookings.findMany({
        where: { contact_id: row.contact_id, status: { in: ['pending', 'confirmed'] }, booking_date: { gte: today } },
        select: { booking_date: true, booking_time: true, services: { select: { name: true } } },
        orderBy: [{ booking_date: 'asc' }, { booking_time: 'asc' }],
        take: 5,
      })
    : []

  let answer: string
  try {
    const res = await voiceFetch('/calls', {
      method: 'POST',
      body: {
        call: row.id,
        sdp: row.sdp_offer,
        api_key: key,
        model: process.env.OPENAI_REALTIME_MODEL?.trim() || DEFAULT_REALTIME_MODEL,
        voice: config.voice,
        language: callLanguage(agent, ctx),
        instructions: voiceInstructions({
          agent,
          ctx,
          config,
          caller: {
            name: contact?.name ?? null,
            phone: contact?.phone ?? null,
            upcoming: upcoming.map((b) => ({ booking_date: b.booking_date, booking_time: b.booking_time, service_name: b.services?.name ?? null })),
          },
        }),
        greeting: callGreeting(config, agent, ctx),
        tools: voiceTools(agent, ctx),
        max_seconds: config.max_minutes * 60,
        callback_url: `${voiceCallbackBase()}/api/voice/calls/${row.id}`,
      },
    })
    if (typeof res.sdp !== 'string' || !res.sdp) throw new Error('no SDP answer')
    answer = res.sdp
  } catch (err) {
    console.error(`[calls:ai] ${row.id}: voice service failed, back to the team:`, message(err))
    await db.whatsapp_calls.updateMany({
      where: { id: row.id, status: 'answering', answered_by: null },
      data: { status: 'ringing', ai_agent_id: null, updated_at: new Date() },
    })
    return false
  }

  try {
    await callAction(channel, row.call_id, 'pre_accept', answer)
    await callAction(channel, row.call_id, 'accept', answer)
  } catch (err) {
    console.error(`[calls:ai] ${row.id}: Meta refused the answer:`, message(err))
    await stopVoiceCall(row.id)
    await db.whatsapp_calls.updateMany({
      where: { id: row.id, ended_at: null },
      data: { status: 'failed', error: message(err).slice(0, 500), ended_at: new Date(), sdp_offer: null, updated_at: new Date() },
    })
    return false
  }
  await db.whatsapp_calls.updateMany({
    where: { id: row.id, status: 'answering' },
    data: { status: 'in_progress', answered_at: new Date(), updated_at: new Date() },
  })
  return true
}

// ---------------------------------------------------------------- tools

/** Call row + everything a tool needs, found by the row id alone (the voice service knows nothing else). */
async function loadCallForVoice(callRowId: string) {
  const row = await prisma.whatsapp_calls.findFirst({ where: { id: callRowId } })
  if (!row || !row.ai_agent_id) return null
  const agent = await loadAgent(row.workspace_id, row.ai_agent_id)
  const ctx = await loadBusinessContext(row.workspace_id)
  if (!agent || !ctx) return null
  return { row, agent, ctx, lang: callLanguage(agent, ctx) as CallLang }
}

type Loaded = NonNullable<Awaited<ReturnType<typeof loadCallForVoice>>>

const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

function draftFrom(args: Record<string, unknown>, ctx: BusinessContext): BookingDraft {
  const details = args.details && typeof args.details === 'object' ? (args.details as Record<string, unknown>) : {}
  const fields: Record<string, string> = {}
  for (const [k, v] of Object.entries(details)) if (typeof v === 'string' && v.trim()) fields[k.slice(0, 60)] = v.trim().slice(0, 200)
  const party = Number(args.party_size)
  return resolveDraftIds(
    {
      service_id: str(args.service_id) || null,
      staff_id: str(args.staff_id) || null,
      date: str(args.date, 10) || null,
      time: str(args.time, 5) || null,
      customer_name: str(args.customer_name, 120) || null,
      party_size: Number.isFinite(party) && party > 0 ? Math.round(party) : null,
      fields,
    },
    ctx,
  )
}

async function whatsappText(c: Loaded, text: string) {
  if (!c.row.conversation_id) return
  await sendMessage({
    workspaceId: c.row.workspace_id,
    conversationId: c.row.conversation_id,
    content: { type: 'text', text },
    sender: { type: 'bot', aiAgentId: c.agent.id },
  }).catch((err) => console.warn('[calls:ai] WhatsApp text failed:', message(err)))
}

const T = {
  es: {
    booked: '✅ Quedó confirmada tu reserva del *{date}* a las *{time}*{extra}.',
    link: 'Para confirmar tu reserva del *{date}* a las *{time}*, termínala aquí: {url}',
    cancelled: 'Quedó cancelada tu reserva del *{date}* a las *{time}*.',
  },
  en: {
    booked: '✅ Your booking on *{date}* at *{time}*{extra} is confirmed.',
    link: 'To confirm your booking on *{date}* at *{time}*, finish it here: {url}',
    cancelled: 'Your booking on *{date}* at *{time}* was cancelled.',
  },
}
const fill = (s: string, vars: Record<string, string>) => s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '')

/** Runs one tool the voice model called. Returns what the model reads back (plain data, no secrets). */
export async function runVoiceTool(callRowId: string, name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const c = await loadCallForVoice(callRowId)
  if (!c) return { error: 'call not found' }
  const { row, agent, ctx, lang } = c
  if (!row.contact_id) return { error: 'unknown caller' }
  try {
    switch (name) {
      case 'check_availability': {
        const draft = draftFrom(args, ctx)
        return { available: availabilityBlock({ ctx, draft: { service_id: draft.service_id, staff_id: draft.staff_id, date: draft.date }, calendlySlots: null }) }
      }
      case 'book_appointment': {
        const draft = draftFrom(args, ctx)
        const result = await createBookingFromDraft({
          workspaceId: row.workspace_id,
          contactId: row.contact_id,
          conversationId: row.conversation_id,
          aiAgentId: agent.id,
          draft,
          source: 'ai',
        })
        if (result.ok) {
          const extra = [result.serviceName ? ` (${result.serviceName})` : '', result.staffName ? (lang === 'en' ? ` with ${result.staffName}` : ` con ${result.staffName}`) : ''].join('')
          await whatsappText(c, fill(T[lang].booked, { date: longDate(draft.date!, lang, ctx), time: draft.time!.padStart(5, '0'), extra }))
          return { booked: true, date: draft.date, time: draft.time, service: result.serviceName, staff: result.staffName, note: 'Confirmation sent by WhatsApp.' }
        }
        if (result.reason === 'link') {
          await whatsappText(c, fill(T[lang].link, { date: longDate(draft.date!, lang, ctx), time: draft.time!.padStart(5, '0'), url: result.url }))
          return { booked: false, reason: 'The booking is finished on a link that was just sent by WhatsApp. Tell the caller.' }
        }
        return { booked: false, ...result }
      }
      case 'cancel_appointment': {
        const done = await cancelNextBooking(row.workspace_id, row.contact_id, { date: str(args.date, 10) || null, time: str(args.time, 5) || null })
        if (!done) return { cancelled: false, reason: 'No upcoming booking matches.' }
        await whatsappText(c, fill(T[lang].cancelled, { date: longDate(done.date, lang, ctx), time: done.time }))
        return { cancelled: true, date: done.date, time: done.time }
      }
      case 'search_products': {
        const products = await searchProducts(row.workspace_id, { text: str(args.query), limit: 5 })
        return {
          products: products.map((p) => ({
            name: p.name,
            price: p.price === null ? 'price on request' : formatProductPrice(Number(p.price), p, ctx.workspace),
            in_stock: !p.track_stock || (p.stock ?? 0) > 0,
            description: p.description?.slice(0, 200) ?? null,
          })),
        }
      }
      case 'transfer_to_human': {
        if (!row.conversation_id) return { ok: false }
        const reason = str(args.reason, 300) || (lang === 'en' ? 'Asked for a person' : 'Pidió hablar con una persona')
        await handOverToHuman(
          { workspaceId: row.workspace_id, contactId: row.contact_id, conversationId: row.conversation_id, messageText: `📞 ${reason}` },
          lang === 'en' ? `During an AI call: ${reason}` : `En una llamada con la IA: ${reason}`,
          { agent },
        )
        await tenantDb(row.workspace_id).tasks.create({
          data: {
            workspace_id: row.workspace_id,
            title: lang === 'en' ? 'Call the customer back' : 'Devolver la llamada',
            description: reason,
            due_at: new Date(Date.now() + 60 * 60_000),
            priority: 'high',
            contact_id: row.contact_id,
            conversation_id: row.conversation_id,
            created_by: null,
          },
        })
        return { ok: true, note: 'The team was notified and will get back to the caller on WhatsApp. Say goodbye and end the call.' }
      }
      default:
        return { error: `unknown tool ${name}` }
    }
  } catch (err) {
    console.error(`[calls:ai] tool ${name} failed:`, message(err))
    return { error: 'The system could not do it right now. Apologize and offer that the team gets back to the caller.' }
  }
}

// ---------------------------------------------------------------- end

export interface TranscriptLine {
  role: 'user' | 'assistant'
  text: string
  at: string | null
}

export function normalizeTranscript(raw: unknown): TranscriptLine[] {
  if (!Array.isArray(raw)) return []
  const out: TranscriptLine[] = []
  for (const l of raw.slice(0, 500)) {
    if (!l || typeof l !== 'object') continue
    const { role, text, at } = l as Record<string, unknown>
    if ((role !== 'user' && role !== 'assistant') || typeof text !== 'string' || !text.trim()) continue
    out.push({ role, text: text.trim().slice(0, 2000), at: typeof at === 'string' ? at.slice(0, 40) : null })
  }
  return out
}

async function summarize(workspaceId: string, lines: TranscriptLine[], lang: CallLang, meta: { agentId: string; conversationId: string | null; channelId: string }) {
  if (lines.length < 2) return null
  const transcript = lines.map((l) => `${l.role === 'user' ? 'Customer' : 'AI'}: ${l.text}`).join('\n').slice(0, 12_000)
  try {
    const raw = await completeJson({
      system: `Summarize this phone call between a customer and a business's AI assistant in 1–3 short sentences, in ${lang === 'en' ? 'English' : 'Spanish'}: what the customer wanted and what was done or is pending. Reply as JSON {"summary": string}.`,
      turns: [{ role: 'user', content: transcript }],
      schema: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] },
      temperature: 0.2,
      meter: { workspaceId, purpose: 'call_summary', aiAgentId: meta.agentId, conversationId: meta.conversationId, channelId: meta.channelId },
    })
    const out = parseJsonLoose<{ summary?: string }>(raw)
    return out?.summary?.trim().slice(0, 1000) || null
  } catch (err) {
    console.warn('[calls:ai] summary failed:', message(err))
    return null
  }
}

/**
 * The voice service finished (the caller hung up, the AI ended it, or the
 * time ran out): store the transcript, leave a note in the conversation
 * and, when the AI ended it, hang up on WhatsApp's side.
 */
export async function finishAiCall(callRowId: string, input: { transcript: unknown; hangup: boolean; reason: string | null }, loadChannel: (id: string) => Promise<LoadedChannel | null>) {
  const c = await loadCallForVoice(callRowId)
  if (!c) return
  const { row, agent, lang } = c
  const db = tenantDb(row.workspace_id)
  if (input.hangup && !row.ended_at) {
    const channel = await loadChannel(row.channel_id)
    if (channel) await callAction(channel, row.call_id, 'terminate').catch((err) => console.warn('[calls:ai] terminate failed:', message(err)))
  }
  if (row.ai_transcript) return // already stored (retried callback)
  const lines = normalizeTranscript(input.transcript)
  const summary = await summarize(row.workspace_id, lines, lang, { agentId: agent.id, conversationId: row.conversation_id, channelId: row.channel_id })
  const saved = await db.whatsapp_calls.updateMany({
    where: { id: row.id, ai_transcript: { equals: Prisma.AnyNull } },
    data: { ai_transcript: lines as unknown as object, ai_summary: summary, updated_at: new Date() },
  })
  if (!saved.count || !row.conversation_id || (!lines.length && !summary)) return
  const who = (l: TranscriptLine) => (l.role === 'user' ? (lang === 'en' ? 'Customer' : 'Cliente') : agent.name)
  const text = [
    `📞 ${lang === 'en' ? 'Call answered by' : 'Llamada atendida por'} ${agent.name} (IA)`,
    summary ? `\n${lang === 'en' ? 'Summary' : 'Resumen'}: ${summary}` : '',
    lines.length ? `\n${lang === 'en' ? 'Transcript' : 'Transcripción'}:\n${lines.map((l) => `${who(l)}: ${l.text}`).join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, 20_000)
  await db.messages.create({
    data: {
      workspace_id: row.workspace_id,
      conversation_id: row.conversation_id,
      sender_type: 'bot',
      ai_agent_id: agent.id,
      content_type: 'text',
      content_text: text,
      status: 'delivered',
      is_internal: true,
      metadata: { kind: 'ai_call', call_id: row.id },
    },
  })
}

/** 'call_minute' tokens for an AI call, once (any started minute counts). */
export async function billAiCall(workspaceId: string, callRowId: string): Promise<void> {
  const db = tenantDb(workspaceId)
  const row = await db.whatsapp_calls.findFirst({ where: { id: callRowId }, select: { ai_agent_id: true, duration_seconds: true, conversation_id: true, billed_at: true } })
  if (!row?.ai_agent_id || row.billed_at) return
  const minutes = billableMinutes(row.duration_seconds)
  const claimed = await db.whatsapp_calls.updateMany({ where: { id: callRowId, billed_at: null }, data: { billed_at: new Date() } })
  if (!claimed.count || minutes === 0) return
  await spend(workspaceId, 'call_minute', { conversationId: row.conversation_id, times: minutes, note: `${minutes} min` })
}

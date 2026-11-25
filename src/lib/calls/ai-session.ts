import 'server-only'
import { timingSafeEqual } from 'node:crypto'
import { getAiConfig } from '@/lib/platform/settings'
import { getPreset, industryLabel, resolveIndustry } from '@/lib/industries'
import { businessFacts, TONES } from '@/lib/ai/prompt'
import { zonedNow } from '@/lib/ai/time'
import type { BusinessContext } from '@/lib/ai/context'
import type { AiAgentRow } from '@/lib/ai/types'
import type { CallAiConfig } from './ai-config'

// What the voice service (voice/) needs to run one AI call: the agent's
// instructions for a spoken conversation, its tools and the voice. The
// tools run here (POST /api/voice/calls/[id]/tool); end_call runs in the
// voice service itself.

export const DEFAULT_REALTIME_MODEL = 'gpt-realtime-2.1'

/** The voice service (VOICE_SERVICE_URL + VOICE_SERVICE_SECRET), or null when it isn't deployed. */
export function voiceService(): { url: string; secret: string } | null {
  const url = process.env.VOICE_SERVICE_URL?.trim().replace(/\/+$/, '')
  const secret = process.env.VOICE_SERVICE_SECRET?.trim()
  return url && secret && secret.length >= 24 ? { url, secret } : null
}

/** Where the voice service calls us back (private network on Railway when set). */
export function voiceCallbackBase(): string | null {
  const base = (process.env.VOICE_CALLBACK_URL || process.env.NEXT_PUBLIC_SITE_URL || '').trim().replace(/\/+$/, '')
  return base || null
}

/** OpenAI key for Realtime (an OpenRouter key can't do Realtime). */
export async function realtimeKey(): Promise<string | null> {
  const own = process.env.OPENAI_REALTIME_API_KEY?.trim()
  if (own) return own
  const key = (await getAiConfig()).keys.openai
  return key && !key.startsWith('sk-or-') ? key : null
}

export interface VoiceTool {
  name: string
  description: string
  parameters: { type: 'object'; properties: Record<string, unknown>; required: string[] }
}

export type VoiceToolName = 'check_availability' | 'book_appointment' | 'cancel_appointment' | 'search_products' | 'transfer_to_human' | 'end_call'

const DATE = { type: 'string', description: 'Date as YYYY-MM-DD' }

function tool(name: VoiceToolName, description: string, properties: Record<string, unknown> = {}, required: string[] = []): VoiceTool {
  return { name, description, parameters: { type: 'object', properties, required } }
}

/** Which parts of the business the agent may act on during a call. */
export function voiceAbilities(agent: AiAgentRow, ctx: BusinessContext) {
  const skills = new Set(agent.skills)
  const { modules } = resolveIndustry(ctx.workspace.industry, ctx.workspace.settings)
  return {
    bookings: skills.has('bookings') && !!modules.bookings,
    catalog: (skills.has('catalog') || skills.has('orders')) && !!modules.products && ctx.catalog.total > 0,
  }
}

export function voiceTools(agent: AiAgentRow, ctx: BusinessContext): VoiceTool[] {
  const can = voiceAbilities(agent, ctx)
  const tools: VoiceTool[] = []
  if (can.bookings) {
    tools.push(
      tool(
        'check_availability',
        'Free start times to book. Call it before offering any time.',
        {
          date: { ...DATE, description: 'A specific date (YYYY-MM-DD). Leave empty for the next days.' },
          service_id: { type: 'string', description: 'Id of the service from the list (in brackets).' },
          staff_id: { type: 'string', description: 'Id of the staff member from the list (in brackets).' },
        },
      ),
      tool(
        'book_appointment',
        'Books it. Only after reading every detail back to the caller and hearing a clear yes.',
        {
          service_id: { type: 'string', description: 'Id of the service (in brackets).' },
          staff_id: { type: 'string', description: 'Id of the staff member (in brackets), if any.' },
          date: DATE,
          time: { type: 'string', description: 'Start time as HH:MM (24 h), one of the free times.' },
          customer_name: { type: 'string', description: "The caller's name." },
          party_size: { type: 'integer', description: 'Number of people, when it applies.' },
          details: { type: 'object', description: 'Other booking details asked for, as {key: value}.', additionalProperties: { type: 'string' } },
        },
        ['date', 'time'],
      ),
      tool('cancel_appointment', "Cancels the caller's next booking (or the one on that date/time). Only after the caller confirms.", {
        date: DATE,
        time: { type: 'string', description: 'HH:MM' },
      }),
    )
  }
  if (can.catalog) {
    tools.push(
      tool('search_products', 'Looks up products: names, prices and stock.', { query: { type: 'string', description: 'What the caller is looking for.' } }, ['query']),
    )
  }
  tools.push(
    tool(
      'transfer_to_human',
      'The caller wants a person, or you cannot help. The team gets the conversation and calls or writes back. Then say goodbye and end the call.',
      { reason: { type: 'string', description: 'Short reason, in the language of the call.' } },
      ['reason'],
    ),
    tool('end_call', 'Hangs up. Call it right after your goodbye, when the conversation is over.'),
  )
  return tools
}

export type CallLang = 'es' | 'en'

export function callLanguage(agent: AiAgentRow, ctx: BusinessContext): CallLang {
  if (agent.language === 'es' || agent.language === 'en') return agent.language
  return ctx.workspace.locale === 'en' ? 'en' : 'es'
}

/** Chat greetings may carry emojis and *markup*: keep plain words only. */
export function spokenText(text: string): string {
  return text
    .replace(/[*_~`]/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\p{Extended_Pictographic}|️/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function callGreeting(config: CallAiConfig, agent: AiAgentRow, ctx: BusinessContext): string {
  const own = spokenText((config.greeting || '').replace(/\{business\}/gi, ctx.workspace.name))
  if (own) return own
  return callLanguage(agent, ctx) === 'en'
    ? `Hi, thanks for calling ${ctx.workspace.name}. This is ${agent.name}, how can I help you?`
    : `Hola, gracias por llamar a ${ctx.workspace.name}. Te habla ${agent.name}, ¿en qué te puedo ayudar?`
}

export interface CallerInfo {
  name: string | null
  phone: string | null
  upcoming: { booking_date: string; booking_time: string; service_name: string | null }[]
}

/** Instructions of the Realtime session: who it is, how to talk on the phone, the business and its tools. */
export function voiceInstructions(input: { agent: AiAgentRow; ctx: BusinessContext; config: CallAiConfig; caller: CallerInfo }): string {
  const { agent, ctx, caller } = input
  const ws = ctx.workspace
  const preset = getPreset(ws.industry)
  const L = (k: Parameters<typeof industryLabel>[1]) => industryLabel(ws.industry, k, 'en', ws.settings)
  const can = voiceAbilities(agent, ctx)
  const lang = callLanguage(agent, ctx)
  const now = zonedNow(ctx.timeZone)
  const sections: string[] = []

  sections.push(
    [
      `You are "${agent.name}", the voice assistant of "${ws.name}". You are on a live WhatsApp voice call with a customer.`,
      preset.ai.persona.en,
      agent.persona ? `Your personality: ${agent.persona}` : '',
      `Tone: ${TONES[agent.tone] ?? agent.tone}.`,
      agent.language === 'auto'
        ? `Speak ${lang === 'en' ? 'English' : 'Spanish'}; if the caller speaks another language, switch to it.`
        : `Always speak ${lang === 'en' ? 'English' : 'Spanish'}.`,
    ]
      .filter(Boolean)
      .join('\n'),
  )

  sections.push(
    [
      'HOW TO TALK ON THE PHONE:',
      '- Short, natural sentences: one or two per turn, then let the caller speak.',
      '- Never read lists, symbols, links, ids or markup aloud. Say at most three options at a time.',
      '- Say dates, times and prices the way people say them out loud (e.g. "el martes 4 a las tres de la tarde").',
      '- If you did not understand, ask again briefly. Confirm names, dates and times by repeating them.',
      '- Never invent information that is not here. If you do not know, say so and offer that a person from the team gets back to them.',
      '- Never promise actions you cannot do (discounts, emails, holding stock, calling back at a set time).',
      `- When the conversation is over, say a short goodbye and then call end_call. Calls last at most ${input.config.max_minutes} minutes.`,
    ].join('\n'),
  )

  if (agent.instructions?.trim()) sections.push(`OWNER INSTRUCTIONS (follow them):\n${agent.instructions.trim()}`)
  if (agent.training_context?.trim()) {
    sections.push(`BUSINESS KNOWLEDGE FROM THE OWNER (your main source: never contradict it, never invent beyond it):\n${agent.training_context.trim()}`)
  }
  const rules = preset.ai.rules.map((r) => `- ${r.en}`)
  if (rules.length) sections.push(`INDUSTRY RULES:\n${rules.join('\n')}`)

  sections.push(...businessFacts(ctx, agent))

  sections.push(
    [
      'CALLER:',
      `- Name on file: ${caller.name || 'unknown (ask for it when you need it)'}`,
      caller.phone ? `- WhatsApp number: +${caller.phone}` : '',
      `- Now: ${now.weekday} ${now.date} ${now.time} (${ctx.timeZone})`,
      can.bookings && caller.upcoming.length
        ? `- Upcoming bookings: ${caller.upcoming.map((b) => `${b.booking_date} ${b.booking_time}${b.service_name ? ` ${b.service_name}` : ''}`).join('; ')}`
        : '',
    ]
      .filter(Boolean)
      .join('\n'),
  )

  if (can.bookings) {
    const fields = preset.bookingFields.filter((f) => f.type !== 'product' && f.required && f.key !== 'customer_name')
    sections.push(
      [
        `BOOKINGS ("${L('booking')}"):`,
        `- Collect, a question at a time: ${ctx.services.length ? 'service, ' : ''}${preset.bookingNeedsStaff && ctx.staff.length ? `${L('staff').toLowerCase()} (or anyone), ` : ''}date and time, and the caller's name${fields.length ? `, plus: ${fields.map((f) => f.label.en).join(', ')}` : ''}.`,
        '- Always call check_availability before offering times, and offer only times it returns.',
        '- Read every detail back and ask for a clear yes before calling book_appointment. Only the result of book_appointment confirms it: if it fails, explain and offer another time.',
        '- To cancel, confirm which booking first, then call cancel_appointment.',
        '- The caller gets the confirmation by WhatsApp too.',
      ].join('\n'),
    )
  } else {
    sections.push('BOOKINGS: you cannot book on this call. If asked, offer that a person from the team gets back to them (transfer_to_human).')
  }
  if (can.catalog) {
    sections.push(`PRODUCTS: use search_products for "${L('productPlural')}", prices and stock. Mention two or three results at most. Orders are placed by WhatsApp chat: tell the caller they can write to this same number.`)
  }
  sections.push('A PERSON: if the caller asks for a person, is upset, or you cannot help, call transfer_to_human, tell them the team will get back to them shortly on this WhatsApp, say goodbye and call end_call.')

  return sections.join('\n\n')
}

/** Requests from the voice service carry `Authorization: Bearer VOICE_SERVICE_SECRET`. */
export function voiceAuthorized(request: Request): boolean {
  const svc = voiceService()
  const header = request.headers.get('authorization') ?? ''
  if (!svc || !header.startsWith('Bearer ')) return false
  const a = Buffer.from(header.slice(7).trim())
  const b = Buffer.from(svc.secret)
  return a.length === b.length && timingSafeEqual(a, b)
}

// AI assist — pure helpers (no server imports): media URL classification,
// workspace switches, how media messages read as text for the models,
// and the summary / suggested-reply prompts.

import { storagePathFromUrl } from '@/lib/storage/paths'

export type MediaRef =
  | { kind: 'wa_proxy'; channelId: string; mediaId: string }
  | { kind: 'wa_legacy'; mediaId: string }
  | { kind: 'attachment'; path: string }
  | { kind: 'external'; url: string }

const SB_ATTACHMENT_PREFIX = 'sb://attachments/'

function safePath(p: string): boolean {
  return !!p && !p.includes('..') && !p.startsWith('/') && /^[A-Za-z0-9/_.\- ]+$/.test(p)
}

/** Where a stored message media_url points. Null for anything we won't fetch. */
export function classifyMediaUrl(url: string | null | undefined): MediaRef | null {
  if (!url || typeof url !== 'string' || url.length > 4000) return null
  const s = url.trim()
  const proxy = /^\/api\/media\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)$/.exec(s)
  if (proxy) return { kind: 'wa_proxy', channelId: proxy[1], mediaId: proxy[2] }
  const legacy = /^\/api\/whatsapp\/media\/([A-Za-z0-9._-]+)$/.exec(s)
  if (legacy) return { kind: 'wa_legacy', mediaId: legacy[1] }
  if (s.startsWith(SB_ATTACHMENT_PREFIX)) {
    const path = s.slice(SB_ATTACHMENT_PREFIX.length)
    return safePath(path) ? { kind: 'attachment', path } : null
  }
  // Our attachment URLs: /api/files/attachments/<path>?exp&sig (absolute or
  // relative) and legacy Supabase signed URLs copied with the data.
  if (/^https?:\/\//i.test(s) || s.startsWith('/api/files/attachments/')) {
    // URL parsing collapses "../" (also %2e%2e): refuse such attachment
    // URLs outright instead of resolving them to another object.
    const rawPath = s.split('?')[0]
    if (/attachments\//.test(rawPath) && /(\.|%2e)(\.|%2e)/i.test(rawPath)) return null
    const path = storagePathFromUrl(s, 'attachments')
    if (path !== null) return safePath(path) ? { kind: 'attachment', path } : null
  }
  if (/^https:\/\/[^\s]+$/i.test(s)) return { kind: 'external', url: s }
  return null
}

// ------------------------------------------------------------------
// Workspace switches: workspaces.settings.ai_assist
// ------------------------------------------------------------------
export interface AiAssistSettings {
  /** Transcribe inbound voice notes automatically (default on). */
  auto_transcribe: boolean
  /** Describe inbound images for the AI agent (default off). */
  auto_read_images: boolean
}

export function aiAssistSettings(settings: Record<string, unknown> | null | undefined): AiAssistSettings {
  const raw = (settings?.ai_assist ?? {}) as Partial<Record<keyof AiAssistSettings, unknown>>
  return {
    auto_transcribe: raw.auto_transcribe === undefined ? true : raw.auto_transcribe === true,
    auto_read_images: raw.auto_read_images === true,
  }
}

export function parseAiAssistPatch(body: unknown): Partial<AiAssistSettings> | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  const out: Partial<AiAssistSettings> = {}
  for (const k of ['auto_transcribe', 'auto_read_images'] as const) {
    if (k in b) {
      if (typeof b[k] !== 'boolean') return null
      out[k] = b[k] as boolean
    }
  }
  return Object.keys(out).length ? out : null
}

// ------------------------------------------------------------------
// Media messages as text
// ------------------------------------------------------------------
export type AssistLocale = 'es' | 'en'

const MEDIA_LABEL: Record<AssistLocale, Record<string, string>> = {
  es: { image: 'Imagen', document: 'Documento', audio: 'Audio', video: 'Video', sticker: 'Sticker', location: 'Ubicación' },
  en: { image: 'Image', document: 'Document', audio: 'Audio', video: 'Video', sticker: 'Sticker', location: 'Location' },
}

export interface TextableMessage {
  content_type: string
  content_text?: string | null
  transcript?: string | null
  ai_media_text?: string | null
}

/**
 * What a model reads for one message: voice notes become their transcript,
 * images / documents their AI description ("[Imagen: …]") plus caption,
 * other media a "[tipo]" placeholder.
 */
export function messageTextForAi(m: TextableMessage, locale: AssistLocale = 'es'): string {
  const text = (m.content_text ?? '').trim()
  const labels = MEDIA_LABEL[locale] ?? MEDIA_LABEL.es
  if (m.content_type === 'audio') {
    const tr = (m.transcript ?? '').trim()
    return tr || `[${labels.audio}]`
  }
  if ((m.content_type === 'image' || m.content_type === 'document') && m.ai_media_text?.trim()) {
    const label = labels[m.content_type]
    return [`[${label}: ${m.ai_media_text.trim()}]`, text].filter(Boolean).join('\n')
  }
  if (text) return text
  return `[${labels[m.content_type] ?? m.content_type}]`
}

/** Routed text for an image the AI agent should "see". */
export function imageRoutedText(description: string, caption: string | null | undefined, locale: AssistLocale): string {
  return messageTextForAi({ content_type: 'image', content_text: caption ?? '', ai_media_text: description }, locale)
}

// ------------------------------------------------------------------
// Conversation transcript for summary / suggestions
// ------------------------------------------------------------------
export interface TranscriptMessage extends TextableMessage {
  sender_type: string
  sender_name?: string | null
  is_internal?: boolean | null
  created_at: string
}

const ROLE: Record<AssistLocale, { customer: string; agent: string; bot: string }> = {
  es: { customer: 'Cliente', agent: 'Asesor', bot: 'Bot' },
  en: { customer: 'Customer', agent: 'Agent', bot: 'Bot' },
}

/**
 * Chat log as plain lines, oldest first. Internal notes and system rows
 * never reach the model. Keeps the most recent messages within maxChars.
 */
export function buildTranscript(messages: TranscriptMessage[], locale: AssistLocale, maxChars = 24_000): string {
  const roles = ROLE[locale] ?? ROLE.es
  const lines: string[] = []
  for (const m of messages) {
    if (m.is_internal || m.content_type === 'system') continue
    const who =
      m.sender_type === 'customer'
        ? roles.customer
        : m.sender_type === 'bot'
          ? roles.bot
          : m.sender_name
            ? `${roles.agent} (${m.sender_name})`
            : roles.agent
    const when = m.created_at.slice(0, 16).replace('T', ' ')
    lines.push(`[${when}] ${who}: ${messageTextForAi(m, locale).replace(/\s+\n/g, '\n')}`)
  }
  let total = 0
  const kept: string[] = []
  for (let i = lines.length - 1; i >= 0; i--) {
    total += lines[i].length + 1
    if (total > maxChars && kept.length) break
    kept.unshift(lines[i].slice(0, maxChars))
  }
  return kept.join('\n')
}

const LANG_NAME: Record<AssistLocale, string> = { es: 'Spanish', en: 'English' }

export interface ConversationSummary {
  key_points: string[]
  customer_intent: string
  pending: string[]
  next_step: string
}

export const SUMMARY_SCHEMA = {
  type: 'OBJECT',
  properties: {
    key_points: { type: 'ARRAY', items: { type: 'STRING' } },
    customer_intent: { type: 'STRING' },
    pending: { type: 'ARRAY', items: { type: 'STRING' } },
    next_step: { type: 'STRING' },
  },
  required: ['key_points', 'customer_intent', 'pending', 'next_step'],
}

export function summaryPrompt(input: { businessName: string; locale: AssistLocale; transcript: string; contactName?: string | null }): {
  system: string
  user: string
} {
  return {
    system: [
      `You help the team of "${input.businessName}" catch up on a customer chat.`,
      `Write everything in ${LANG_NAME[input.locale]}, concise and factual. Use only what the chat says; never invent.`,
      'Return a JSON object with:',
      '- key_points: 2-6 short bullet strings with the important facts (products, dates, amounts, addresses, decisions).',
      '- customer_intent: one sentence with what the customer wants.',
      '- pending: open items still unanswered or to do (empty array when none).',
      '- next_step: one concrete suggestion for the team member.',
    ].join('\n'),
    user: `${input.contactName ? `Customer: ${input.contactName}\n` : ''}CHAT:\n${input.transcript || '(empty)'}`,
  }
}

function strList(v: unknown, max: number): string[] {
  return Array.isArray(v)
    ? v
        .filter((x): x is string => typeof x === 'string' && !!x.trim())
        .map((x) => x.trim().slice(0, 500))
        .slice(0, max)
    : []
}

export function normalizeSummary(raw: unknown): ConversationSummary | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const out: ConversationSummary = {
    key_points: strList(r.key_points, 8),
    customer_intent: typeof r.customer_intent === 'string' ? r.customer_intent.trim().slice(0, 600) : '',
    pending: strList(r.pending, 8),
    next_step: typeof r.next_step === 'string' ? r.next_step.trim().slice(0, 600) : '',
  }
  if (!out.key_points.length && !out.customer_intent && !out.next_step) return null
  return out
}

/** conversations.ai_summary (JSON text) → summary; legacy/plain text kept as one key point. */
export function parseStoredSummary(text: string | null | undefined): ConversationSummary | null {
  if (!text) return null
  try {
    return normalizeSummary(JSON.parse(text))
  } catch {
    return { key_points: [text.slice(0, 2000)], customer_intent: '', pending: [], next_step: '' }
  }
}

export const SUGGEST_SCHEMA = {
  type: 'OBJECT',
  properties: { reply: { type: 'STRING' } },
  required: ['reply'],
}

export interface SuggestPromptInput {
  businessBlock: string
  persona: { name: string; persona?: string | null; tone?: string | null; instructions?: string | null; language?: string | null } | null
  locale: AssistLocale
  transcript: string
  hint?: string | null
  agentName?: string | null
}

export function suggestPrompt(input: SuggestPromptInput): { system: string; user: string } {
  const p = input.persona
  const language =
    p?.language === 'es' || p?.language === 'en'
      ? `Write in ${LANG_NAME[p.language]}.`
      : `Write in the language the customer uses (default ${LANG_NAME[input.locale]}).`
  return {
    system: [
      p
        ? `You draft the next reply for a team member of the business, speaking as "${p.name}".${p.persona ? ` Personality: ${p.persona}.` : ''}${p.tone ? ` Tone: ${p.tone}.` : ''}`
        : 'You are a helpful, friendly customer-service assistant drafting the next reply for a team member of the business.',
      p?.instructions?.trim() ? `OWNER INSTRUCTIONS:\n${p.instructions.trim()}` : '',
      language,
      'The draft will be reviewed and edited by a person before sending: write ONE short chat message (WhatsApp style) answering the latest customer messages.',
      'Use only facts from BUSINESS and the CHAT. If something is unknown (price, stock, availability), say you will check it or ask a clarifying question — never invent.',
      'Never confirm payment methods, financing, discounts, schedules or policies unless BUSINESS or the team members in the CHAT already stated them; offer to confirm instead.',
      'Do not mention that you are an AI and do not add placeholders like [name] unless the information is missing.',
      'Return JSON: {"reply": "..."}.',
      `BUSINESS:\n${input.businessBlock}`,
    ]
      .filter(Boolean)
      .join('\n\n'),
    user: [`CHAT:\n${input.transcript || '(empty)'}`, input.hint?.trim() ? `TEAM MEMBER'S NOTE FOR THIS DRAFT: ${input.hint.trim().slice(0, 300)}` : '']
      .filter(Boolean)
      .join('\n\n'),
  }
}

/** Prompt for "Leer con IA" / automatic image reading. */
export function mediaReadPrompt(kind: 'image' | 'pdf', locale: AssistLocale, purpose: 'agent' | 'inbox'): string {
  const lang = LANG_NAME[locale]
  if (kind === 'pdf') {
    return `Read this PDF a customer sent to a business. In ${lang}, give a short summary (what document it is, key data: names, dates, amounts, reference numbers) followed by the important text. Max 1200 characters. Plain text, no markdown headings.`
  }
  return purpose === 'agent'
    ? `A customer sent this image in a chat with a business. In ${lang}, describe it in 1-2 short sentences so a chat assistant can answer, including any visible text, prices, amounts or reference numbers. Plain text only.`
    : `A customer sent this image to a business. In ${lang}, describe what it shows and transcribe any visible text (amounts, dates, operation numbers, names). Max 800 characters. Plain text only.`
}

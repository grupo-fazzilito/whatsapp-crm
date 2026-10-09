import 'server-only'
import { tenantDb } from '@/lib/db/tenant'
import { completeJson, parseJsonLoose, type LlmRequest } from './llm'
import type { AiAgentRow } from './types'

// ------------------------------------------------------------
// AI follow-up ("Seguimiento con IA"): one short message that re-engages
// a customer who stopped replying, written from the conversation so far
// in the agent's voice. Used by the automations step `ai_followup`.
// Deliberately compact: persona, tone and language from the agent, the
// recent transcript, and the owner's extra instructions — no catalog,
// availability or booking machinery (that's the reply engine's job).
// ------------------------------------------------------------

const TRANSCRIPT_MESSAGES = 20
const MAX_FOLLOWUP_CHARS = 600

const TONES: Record<string, string> = {
  friendly: 'warm, friendly and close',
  professional: 'professional and clear',
  formal: 'formal and respectful (use "usted" in Spanish)',
  playful: 'playful and upbeat, light use of emojis',
  empathetic: 'empathetic, patient and reassuring',
  concise: 'brief and to the point',
  polite: 'polite and helpful',
}

const CHANNEL_LABEL: Record<string, string> = {
  whatsapp: 'WhatsApp',
  instagram: 'Instagram Direct',
  messenger: 'Facebook Messenger',
  tiktok: 'TikTok',
  webchat: 'the website chat',
}

export const FOLLOWUP_SCHEMA = {
  type: 'OBJECT',
  properties: {
    message: { type: 'STRING', description: 'The follow-up message to send to the customer' },
  },
  required: ['message'],
} as const

export interface TranscriptLine {
  sender_type: string
  content_text: string | null
  content_type?: string | null
}

export interface FollowupPromptInput {
  workspaceId: string
  businessName: string
  /** Workspace default language. */
  locale: 'es' | 'en'
  agent: Pick<AiAgentRow, 'id' | 'name' | 'persona' | 'tone' | 'language' | 'instructions' | 'model'>
  channelType: string | null
  channelId: string | null
  conversationId: string
  contactName: string | null
  /** Oldest first. */
  transcript: TranscriptLine[]
  /** Step-level guidance from the automation. */
  instructions?: string | null
}

export function buildFollowupSystemPrompt(input: FollowupPromptInput): string {
  const { agent } = input
  const channel = CHANNEL_LABEL[input.channelType ?? 'whatsapp'] ?? 'chat'
  const lines: (string | null)[] = [
    `You are "${agent.name}", a virtual assistant of "${input.businessName}" chatting with customers on ${channel}.`,
    agent.persona ? `Your personality: ${agent.persona}` : null,
    `Tone: ${TONES[agent.tone] ?? agent.tone}.`,
    agent.language === 'es' || agent.language === 'en'
      ? `Write in ${agent.language === 'en' ? 'English' : 'Spanish'}.`
      : `Write in the language the customer used (default ${input.locale === 'en' ? 'English' : 'Spanish'}).`,
    '',
    'TASK: the customer stopped replying to our last message. Write ONE short follow-up message (1–2 sentences, WhatsApp style) that:',
    '- picks up exactly where the conversation left off (refer to what was being discussed);',
    '- is friendly and low-pressure, ends with a simple question or next step;',
    '- does NOT repeat our previous message, does NOT invent prices, products, dates or promises not in the conversation;',
    '- does not greet as if it were a new conversation and does not mention that it is automatic.',
    input.contactName ? `Customer name: ${input.contactName} (use it only if it sounds natural).` : null,
    agent.instructions?.trim() ? `OWNER INSTRUCTIONS FOR THIS AGENT:\n${agent.instructions.trim().slice(0, 1500)}` : null,
    input.instructions?.trim() ? `INSTRUCTIONS FOR THIS FOLLOW-UP (priority):\n${input.instructions.trim()}` : null,
    '',
    'Answer as JSON: {"message": "<the follow-up text>"}',
  ]
  return lines.filter((l): l is string => l !== null).join('\n').trim()
}

/** Plain transcript; the whole thing goes in one user turn so every provider accepts it. */
export function formatTranscript(rows: TranscriptLine[], businessName: string): string {
  const out: string[] = []
  for (const r of rows) {
    if (r.content_type === 'system') continue
    const text = (r.content_text ?? '').trim() || `[${r.content_type ?? 'message'}]`
    const who = r.sender_type === 'customer' ? 'Customer' : businessName
    out.push(`${who}: ${text.slice(0, 500)}`)
  }
  return out.join('\n')
}

export function buildFollowupRequest(input: FollowupPromptInput): LlmRequest {
  const transcript = formatTranscript(input.transcript, input.businessName)
  return {
    system: buildFollowupSystemPrompt(input),
    turns: [
      {
        role: 'user',
        content: `CONVERSATION SO FAR (oldest first):\n${transcript || '(no messages)'}\n\nWrite the follow-up now.`,
      },
    ],
    schema: FOLLOWUP_SCHEMA as unknown as Record<string, unknown>,
    model: input.agent.model,
    temperature: 0.6,
    meter: {
      workspaceId: input.workspaceId,
      purpose: 'followup',
      aiAgentId: input.agent.id,
      conversationId: input.conversationId,
      channelId: input.channelId,
    },
  }
}

/** Calls the model and returns the cleaned message. Throws LlmUnavailableError when no provider answers. */
export async function generateFollowup(input: FollowupPromptInput): Promise<string> {
  const raw = await completeJson(buildFollowupRequest(input))
  const parsed = parseJsonLoose<{ message?: unknown }>(raw)
  const message = typeof parsed?.message === 'string' ? parsed.message.trim() : ''
  if (!message) throw new Error('La IA no devolvió un mensaje de seguimiento')
  return message.length > MAX_FOLLOWUP_CHARS ? `${message.slice(0, MAX_FOLLOWUP_CHARS - 1).trimEnd()}…` : message
}

/** Loads everything generateFollowup needs for a conversation. */
export async function loadFollowupInput(args: {
  workspaceId: string
  conversationId: string
  agent: AiAgentRow
  channelType: string | null
  channelId: string | null
  instructions?: string | null
}): Promise<FollowupPromptInput> {
  const db = tenantDb(args.workspaceId)
  // A failed read counts as no row, as with PostgREST.
  const [ws, conv, msgs] = await Promise.all([
    db.workspaces.findFirst({ select: { name: true, locale: true }, where: { id: args.workspaceId } }).catch(() => null),
    db.conversations
      .findFirst({ select: { contacts: { select: { name: true } } }, where: { id: args.conversationId, workspace_id: args.workspaceId } })
      .catch(() => null),
    db.messages
      .findMany({
        select: { sender_type: true, content_text: true, content_type: true },
        where: { workspace_id: args.workspaceId, conversation_id: args.conversationId, is_internal: { not: true } },
        orderBy: { created_at: 'desc' },
        take: TRANSCRIPT_MESSAGES,
      })
      .catch(() => null),
  ])
  return {
    workspaceId: args.workspaceId,
    businessName: ws?.name ?? 'the business',
    locale: ws?.locale === 'en' ? 'en' : 'es',
    agent: args.agent,
    channelType: args.channelType,
    channelId: args.channelId,
    conversationId: args.conversationId,
    contactName: (conv?.contacts as { name?: string | null } | null | undefined)?.name ?? null,
    transcript: ((msgs ?? []) as TranscriptLine[]).reverse(),
    instructions: args.instructions ?? null,
  }
}

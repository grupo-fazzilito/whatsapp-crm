import 'server-only'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { canSpend, spend } from '@/lib/billing/credits'
import { completeJson, describeMedia, parseJsonLoose, transcribeAudio, MediaAiUnavailableError, type UsageMeter } from '@/lib/ai/llm'
import { loadBusinessContext, type BusinessContext } from '@/lib/ai/context'
import { formatMoney, moneyLocale } from '@/lib/workspace/countries'
import {
  SUGGEST_SCHEMA,
  SUMMARY_SCHEMA,
  aiAssistSettings,
  buildTranscript,
  imageRoutedText,
  mediaReadPrompt,
  normalizeSummary,
  suggestPrompt,
  summaryPrompt,
  type AssistLocale,
  type ConversationSummary,
  type TranscriptMessage,
} from './core'
import { fetchMessageMedia, MediaFetchError } from './media'
import { mediaKindOf } from './mime'

export class AssistError extends Error {
  constructor(
    public code: 'not_found' | 'not_media' | 'no_provider' | 'no_credits' | 'too_large' | 'unsupported_type' | 'media_unavailable' | 'failed' | 'empty',
    message?: string,
  ) {
    super(message ?? code)
  }
}

interface WorkspaceBasics {
  id: string
  name: string
  locale: AssistLocale
  settings: Record<string, unknown>
}

async function workspaceBasics(workspaceId: string): Promise<WorkspaceBasics | null> {
  const { data } = await supabaseAdmin().from('workspaces').select('id, name, locale, settings').eq('id', workspaceId).maybeSingle()
  if (!data) return null
  return { id: data.id, name: data.name, locale: data.locale === 'en' ? 'en' : 'es', settings: (data.settings ?? {}) as Record<string, unknown> }
}

interface MediaMessageRow {
  id: string
  conversation_id: string
  content_type: string
  content_text: string | null
  media_url: string | null
  transcript: string | null
  ai_media_text: string | null
  is_internal: boolean | null
}

async function loadMediaMessage(workspaceId: string, messageId: string): Promise<MediaMessageRow> {
  const { data } = await supabaseAdmin()
    .from('messages')
    .select('id, conversation_id, content_type, content_text, media_url, transcript, ai_media_text, is_internal')
    .eq('workspace_id', workspaceId)
    .eq('id', messageId)
    .maybeSingle()
  if (!data) throw new AssistError('not_found')
  return data as MediaMessageRow
}

function mapMediaError(err: unknown): AssistError {
  if (err instanceof AssistError) return err
  if (err instanceof MediaAiUnavailableError) {
    if (err.reason === 'no_provider') return new AssistError('no_provider', err.message)
    if (err.reason === 'too_large') return new AssistError('too_large', err.message)
    if (err.reason === 'unsupported_type') return new AssistError('unsupported_type', err.message)
    return new AssistError('failed', err.message)
  }
  if (err instanceof MediaFetchError) return new AssistError(err.code === 'too_large' ? 'too_large' : 'media_unavailable', err.message)
  return new AssistError('failed', err instanceof Error ? err.message : String(err))
}

// ------------------------------------------------------------------
// Transcription / media reading
// ------------------------------------------------------------------

export interface MediaAssistOptions {
  workspaceId: string
  messageId: string
  /** Re-run even when a stored result exists. */
  force?: boolean
  timeoutMs?: number
  meterExtra?: Partial<UsageMeter>
}

/** Voice note → messages.transcript. */
export async function transcribeMessage(opts: MediaAssistOptions): Promise<{ transcript: string; cached: boolean }> {
  const msg = await loadMediaMessage(opts.workspaceId, opts.messageId)
  if (msg.content_type !== 'audio' || !msg.media_url) throw new AssistError('not_media')
  if (msg.transcript && !opts.force) return { transcript: msg.transcript, cached: true }
  if (!(await canSpend(opts.workspaceId, 'transcription'))) throw new AssistError('no_credits')
  const ws = await workspaceBasics(opts.workspaceId)
  try {
    const media = await fetchMessageMedia(opts.workspaceId, msg.media_url)
    const result = await transcribeAudio({
      bytes: media.bytes,
      mimeType: media.mimeType,
      language: ws?.locale ?? 'es',
      timeoutMs: opts.timeoutMs,
      meter: { workspaceId: opts.workspaceId, purpose: 'transcription', conversationId: msg.conversation_id, ...opts.meterExtra },
    })
    const transcript = result.text.trim()
    await spend(opts.workspaceId, 'transcription', { conversationId: msg.conversation_id })
    await supabaseAdmin()
      .from('messages')
      .update({ transcript, ai_processed_at: new Date().toISOString() })
      .eq('id', msg.id)
      .eq('workspace_id', opts.workspaceId)
    return { transcript, cached: false }
  } catch (err) {
    throw mapMediaError(err)
  }
}

/** Image / PDF → messages.ai_media_text ("Leer con IA"). */
export async function readMessageMedia(
  opts: MediaAssistOptions & { purpose?: 'agent' | 'inbox' },
): Promise<{ text: string; cached: boolean }> {
  const msg = await loadMediaMessage(opts.workspaceId, opts.messageId)
  if ((msg.content_type !== 'image' && msg.content_type !== 'document') || !msg.media_url) throw new AssistError('not_media')
  if (msg.ai_media_text && !opts.force) return { text: msg.ai_media_text, cached: true }
  if (!(await canSpend(opts.workspaceId, 'vision'))) throw new AssistError('no_credits')
  const ws = await workspaceBasics(opts.workspaceId)
  try {
    const media = await fetchMessageMedia(opts.workspaceId, msg.media_url)
    const kind = mediaKindOf(media.mimeType)
    if (kind !== 'image' && kind !== 'pdf') throw new AssistError('unsupported_type', media.mimeType)
    const result = await describeMedia({
      bytes: media.bytes,
      mimeType: media.mimeType,
      prompt: mediaReadPrompt(kind, ws?.locale ?? 'es', opts.purpose ?? 'inbox'),
      maxOutputTokens: kind === 'pdf' ? 1200 : opts.purpose === 'agent' ? 300 : 700,
      timeoutMs: opts.timeoutMs,
      meter: { workspaceId: opts.workspaceId, purpose: 'vision', conversationId: msg.conversation_id, ...opts.meterExtra },
    })
    const text = result.text.trim().slice(0, 4000)
    await spend(opts.workspaceId, 'vision', { conversationId: msg.conversation_id })
    await supabaseAdmin()
      .from('messages')
      .update({ ai_media_text: text, ai_processed_at: new Date().toISOString() })
      .eq('id', msg.id)
      .eq('workspace_id', opts.workspaceId)
    return { text, cached: false }
  } catch (err) {
    throw mapMediaError(err)
  }
}

// ------------------------------------------------------------------
// Inbound pre-routing hook (ingest)
// ------------------------------------------------------------------

export interface InboundMediaInput {
  workspaceId: string
  channelId: string
  conversationId: string
  messageId: string
  contentType: string
  mediaUrl: string | null
  caption: string | null
  /** An AI agent will answer this message (conversation/channel agent, not paused). */
  aiWillAnswer: boolean
  aiAgentId?: string | null
}

/**
 * Text the flows / AI agent should see for an inbound voice note (its
 * transcript) or image (its description, when the workspace enabled
 * it). Null = nothing to add; never throws.
 */
export async function inboundMediaText(input: InboundMediaInput): Promise<string | null> {
  try {
    if (!input.mediaUrl) return null
    const isAudio = input.contentType === 'audio'
    const isImage = input.contentType === 'image'
    if (!isAudio && !isImage) return null
    const ws = await workspaceBasics(input.workspaceId)
    if (!ws) return null
    const s = aiAssistSettings(ws.settings)
    const meterExtra = { channelId: input.channelId, aiAgentId: input.aiAgentId ?? null }
    if (isAudio) {
      if (!s.auto_transcribe) return null
      const { transcript } = await transcribeMessage({ workspaceId: input.workspaceId, messageId: input.messageId, timeoutMs: 20_000, meterExtra })
      return transcript || null
    }
    if (!s.auto_read_images || !input.aiWillAnswer) return null
    const { text } = await readMessageMedia({ workspaceId: input.workspaceId, messageId: input.messageId, purpose: 'agent', timeoutMs: 15_000, meterExtra })
    return text ? imageRoutedText(text, input.caption, ws.locale) : null
  } catch (err) {
    const code = err instanceof AssistError ? err.code : 'failed'
    // No multimodal provider is a normal setup (DeepSeek only): stay quiet.
    if (code !== 'no_provider') console.warn('[ai-assist] inbound media skipped:', code, err instanceof Error ? err.message.slice(0, 200) : '')
    return null
  }
}

// ------------------------------------------------------------------
// Conversation summary and suggested reply (text models; DeepSeek works)
// ------------------------------------------------------------------

async function conversationMessages(workspaceId: string, conversationId: string, limit: number): Promise<TranscriptMessage[]> {
  const db = supabaseAdmin()
  const { data } = await db
    .from('messages')
    .select('sender_type, sender_id, content_type, content_text, transcript, ai_media_text, is_internal, created_at')
    .eq('workspace_id', workspaceId)
    .eq('conversation_id', conversationId)
    // Team-only notes never reach the model.
    .neq('is_internal', true)
    .neq('content_type', 'system')
    .order('created_at', { ascending: false })
    .limit(limit)
  const rows = (data ?? []).reverse()
  const ids = [...new Set(rows.map((r) => r.sender_id).filter((x): x is string => !!x && rows.some((r) => r.sender_type === 'agent' && r.sender_id === x)))]
  const names = new Map<string, string>()
  if (ids.length) {
    const { data: profiles } = await db.from('profiles').select('id, full_name').in('id', ids)
    for (const p of profiles ?? []) if (p.full_name) names.set(p.id, p.full_name.split(' ')[0])
  }
  return rows.map((r) => ({ ...r, sender_name: r.sender_type === 'agent' && r.sender_id ? (names.get(r.sender_id) ?? null) : null }))
}

async function loadConversation(workspaceId: string, conversationId: string) {
  const { data } = await supabaseAdmin()
    .from('conversations')
    .select('id, channel_id, ai_agent_id, contact:contacts(name)')
    .eq('workspace_id', workspaceId)
    .eq('id', conversationId)
    .maybeSingle()
  if (!data) throw new AssistError('not_found')
  const contact = (Array.isArray(data.contact) ? data.contact[0] : data.contact) as { name: string | null } | null
  return { id: data.id as string, channelId: (data.channel_id as string | null) ?? null, aiAgentId: (data.ai_agent_id as string | null) ?? null, contactName: contact?.name ?? null }
}

export interface StoredSummary {
  summary: ConversationSummary
  at: string
  by: string | null
}

export async function summarizeConversation(input: { workspaceId: string; conversationId: string; userId: string }): Promise<StoredSummary> {
  const conv = await loadConversation(input.workspaceId, input.conversationId)
  const ws = await workspaceBasics(input.workspaceId)
  if (!ws) throw new AssistError('not_found')
  const messages = await conversationMessages(input.workspaceId, conv.id, 200)
  if (!messages.length) throw new AssistError('empty')
  if (!(await canSpend(input.workspaceId, 'summary'))) throw new AssistError('no_credits')
  const prompt = summaryPrompt({ businessName: ws.name, locale: ws.locale, transcript: buildTranscript(messages, ws.locale), contactName: conv.contactName })
  const raw = await completeJson({
    system: prompt.system,
    turns: [{ role: 'user', content: prompt.user }],
    schema: SUMMARY_SCHEMA,
    temperature: 0.2,
    timeoutMs: 30_000,
    meter: { workspaceId: input.workspaceId, purpose: 'summary', conversationId: conv.id, channelId: conv.channelId },
  })
  const summary = normalizeSummary(parseJsonLoose(raw))
  if (!summary) throw new AssistError('failed', 'Unreadable summary')
  await spend(input.workspaceId, 'summary', { conversationId: conv.id })
  const at = new Date().toISOString()
  await supabaseAdmin()
    .from('conversations')
    .update({ ai_summary: JSON.stringify(summary), ai_summary_at: at, ai_summary_by: input.userId })
    .eq('id', conv.id)
    .eq('workspace_id', input.workspaceId)
  return { summary, at, by: input.userId }
}

// Same wording as the agent prompt (src/lib/ai/prompt.ts).
const TONE_TEXT: Record<string, string> = {
  friendly: 'warm, friendly and close',
  professional: 'professional and clear',
  formal: 'formal and respectful (use "usted" in Spanish)',
  playful: 'playful and upbeat, light use of emojis',
  empathetic: 'empathetic, patient and reassuring',
  concise: 'brief and to the point',
  polite: 'polite and helpful',
}

/** Compact business facts for drafting replies. */
export function businessBlock(ctx: BusinessContext): string {
  const ws = ctx.workspace
  const money = (n: number | null | undefined, cur?: string | null) =>
    n === null || n === undefined ? '' : formatMoney(Number(n), cur || ws.currency, moneyLocale(ws))
  const lines = [
    `- Name: ${ws.name}${ws.business_type_detail ? ` (${ws.business_type_detail})` : ''}`,
    ws.description ? `- About: ${ws.description.slice(0, 600)}` : '',
    [ws.address, ws.city].filter(Boolean).length ? `- Address: ${[ws.address, ws.city].filter(Boolean).join(', ')}` : '',
    ws.phone ? `- Phone: ${ws.phone}` : '',
    ws.website ? `- Website: ${ws.website}` : '',
  ]
  if (ctx.hours.length) {
    lines.push(
      `- Hours: ${ctx.hours
        .map((h) => `${h.day_name.slice(0, 3)} ${h.is_closed ? 'closed' : `${h.opening_time?.slice(0, 5)}-${h.closing_time?.slice(0, 5)}`}`)
        .join('; ')}`,
    )
  }
  if (ctx.services.length) {
    lines.push('SERVICES:')
    for (const s of ctx.services.slice(0, 30)) {
      lines.push(`- ${s.name}${s.price !== null ? `: ${s.price_is_from ? 'from ' : ''}${money(s.price)}` : ''}${s.duration_minutes ? ` (${s.duration_minutes} min)` : ''}`)
    }
  }
  if (ctx.catalog.products?.length) {
    lines.push('PRODUCTS:')
    for (const p of ctx.catalog.products.slice(0, 25)) {
      lines.push(`- ${p.name}${p.price !== null ? `: ${money(p.price, p.currency)}` : ''}${p.track_stock && (p.stock ?? 0) <= 0 ? ' (out of stock)' : ''}`)
    }
  } else if (ctx.catalog.total > 0) {
    lines.push(`- Catalog: ${ctx.catalog.total} products (categories: ${ctx.catalog.categories.map((c) => c.name).slice(0, 15).join(', ') || '—'})`)
  }
  if (ctx.faqs.length) {
    lines.push('FAQ:')
    for (const f of ctx.faqs.slice(0, 20)) lines.push(`- Q: ${f.question.slice(0, 200)} A: ${f.answer.slice(0, 400)}`)
  }
  return lines.filter(Boolean).join('\n')
}

export async function suggestReply(input: { workspaceId: string; conversationId: string; hint?: string | null }): Promise<{ draft: string }> {
  const conv = await loadConversation(input.workspaceId, input.conversationId)
  const ctx = await loadBusinessContext(input.workspaceId)
  if (!ctx) throw new AssistError('not_found')
  const locale: AssistLocale = ctx.workspace.locale === 'en' ? 'en' : 'es'
  // Persona: the conversation's agent, else the channel's agent, else neutral.
  let agentId = conv.aiAgentId
  if (!agentId && conv.channelId) {
    const { data: ch } = await supabaseAdmin().from('channels').select('ai_agent_id').eq('id', conv.channelId).eq('workspace_id', input.workspaceId).maybeSingle()
    agentId = (ch?.ai_agent_id as string | null) ?? null
  }
  const agent = agentId ? (ctx.agents.find((a) => a.id === agentId) ?? null) : null
  const messages = await conversationMessages(input.workspaceId, conv.id, 40)
  if (!messages.length) throw new AssistError('empty')
  if (!(await canSpend(input.workspaceId, 'suggest'))) throw new AssistError('no_credits')
  const prompt = suggestPrompt({
    businessBlock: businessBlock(ctx),
    persona: agent
      ? { name: agent.name, persona: agent.persona, tone: TONE_TEXT[agent.tone] ?? agent.tone, instructions: agent.instructions, language: agent.language }
      : null,
    locale,
    transcript: buildTranscript(messages, locale, 12_000),
    hint: input.hint,
  })
  const raw = await completeJson({
    system: prompt.system,
    turns: [{ role: 'user', content: prompt.user }],
    schema: SUGGEST_SCHEMA,
    model: agent?.model ?? null,
    temperature: 0.4,
    timeoutMs: 25_000,
    meter: { workspaceId: input.workspaceId, purpose: 'suggest', conversationId: conv.id, channelId: conv.channelId, aiAgentId: agent?.id ?? null },
  })
  const parsed = parseJsonLoose<{ reply?: unknown }>(raw)
  const draft = typeof parsed?.reply === 'string' ? parsed.reply.trim() : ''
  if (!draft) throw new AssistError('failed', 'Empty draft')
  await spend(input.workspaceId, 'suggest', { conversationId: conv.id })
  return { draft: draft.slice(0, 4000) }
}

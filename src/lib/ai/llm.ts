import 'server-only'
import { getAiConfig, getPlatformSetting, type AiConfig, type AiProvider } from '@/lib/platform/settings'
import { costUsd, priceFor, type ModelPrice, type TokenUsage } from './pricing'
import { OPENAI_IMAGE_TYPES, audioFileName, mediaKindOf, normalizeMime, resolveMime } from './assist/mime'

// JSON-mode chat completion over several providers, tried in order until
// one answers: Gemini (with a circuit breaker for hard failures),
// DeepSeek and OpenAI / OpenRouter. Keys, order and default models come
// from the platform admin panel (platform_settings 'ai'), falling back to
// env vars (GEMINI_API_KEY, DEEPSEEK_API_KEY, OPENAI_API_KEY,
// AI_PROVIDER_ORDER). An agent's model ("deepseek-…", "gemini-…",
// "gpt-…") puts that provider first for that agent.

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

export interface LlmRequest {
  system: string
  turns: ChatTurn[]
  /** Gemini responseSchema (OpenAPI subset). OpenAI gets json_object mode. */
  schema: Record<string, unknown>
  model?: string | null
  temperature?: number
  timeoutMs?: number
  /** When set, the call is recorded in ai_usage (tokens + cost). */
  meter?: UsageMeter
}

export interface UsageMeter {
  workspaceId: string
  /** reply | playground | import | triage | followup | catalog */
  purpose: string
  aiAgentId?: string | null
  conversationId?: string | null
  channelId?: string | null
}

interface ProviderResult {
  text: string
  model: string
  usage: TokenUsage
}

const noUsage = (): TokenUsage => ({ input: 0, cachedInput: 0, output: 0 })

export class LlmUnavailableError extends Error {}

/**
 * Provider base URLs. AI_PROVIDER_MOCK_URL (ignored in production) points
 * Gemini and OpenAI at a local mock (`<mock>/gemini/...`, `<mock>/openai/...`)
 * so E2E tests never send fake keys to the real APIs.
 */
export function providerBases(env: Record<string, string | undefined> = process.env): { gemini: string; openai: string; openrouter: string } {
  const mock = env.NODE_ENV !== 'production' ? env.AI_PROVIDER_MOCK_URL?.replace(/\/$/, '') : undefined
  if (mock) return { gemini: `${mock}/gemini`, openai: `${mock}/openai/v1`, openrouter: `${mock}/openrouter/api/v1` }
  return {
    gemini: 'https://generativelanguage.googleapis.com',
    openai: 'https://api.openai.com/v1',
    openrouter: 'https://openrouter.ai/api/v1',
  }
}

const DEFAULT_GEMINI = 'gemini-2.5-flash'
const BACKUP_GEMINI = 'gemini-2.0-flash'
const CIRCUIT_MS = 60_000
let geminiOpenUntil = 0

async function gemini(model: string, req: LlmRequest, key: string): Promise<{ ok: boolean; status: number; text: string; usage: TokenUsage }> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), req.timeoutMs ?? 12_000)
  try {
    const res = await fetch(`${providerBases().gemini}/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      signal: ctrl.signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: req.system }] },
        contents: req.turns.map((t) => ({ role: t.role === 'assistant' ? 'model' : 'user', parts: [{ text: t.content }] })),
        generationConfig: {
          temperature: req.temperature ?? 0.3,
          responseMimeType: 'application/json',
          responseSchema: req.schema,
        },
      }),
    })
    const body = await res.text()
    if (!res.ok) return { ok: false, status: res.status, text: body, usage: noUsage() }
    const data = JSON.parse(body)
    const u = data.usageMetadata ?? {}
    return {
      ok: true,
      status: 200,
      text: data.candidates?.[0]?.content?.parts?.[0]?.text ?? '',
      usage: {
        input: u.promptTokenCount ?? 0,
        cachedInput: u.cachedContentTokenCount ?? 0,
        // Thinking tokens are billed as output.
        output: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0),
      },
    }
  } finally {
    clearTimeout(timer)
  }
}

async function openai(req: LlmRequest, key: string, defaultModel?: string): Promise<ProviderResult> {
  const viaOpenRouter = key.startsWith('sk-or-')
  const bases = providerBases()
  const url = `${viaOpenRouter ? bases.openrouter : bases.openai}/chat/completions`
  const isOpenAiModel = req.model && /^(gpt|o\d)/.test(req.model)
  const model = isOpenAiModel ? req.model! : defaultModel || 'gpt-4o-mini'
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), req.timeoutMs ?? 15_000)
  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
        ...(viaOpenRouter
          ? { 'HTTP-Referer': process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3001', 'X-Title': 'Whasalia' }
          : {}),
      },
      body: JSON.stringify({
        model: viaOpenRouter ? `openai/${model}` : model,
        temperature: req.temperature ?? 0.3,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: `${req.system}\n\nRespond with a single JSON object only.` },
          ...req.turns,
        ],
      }),
    })
    if (!res.ok) throw new Error(`${viaOpenRouter ? 'OpenRouter' : 'OpenAI'} ${res.status}: ${await res.text()}`)
    const data = await res.json()
    const content = data.choices?.[0]?.message?.content
    if (!content) throw new Error('Empty completion')
    const u = data.usage ?? {}
    return {
      text: content,
      model,
      usage: { input: u.prompt_tokens ?? 0, cachedInput: u.prompt_tokens_details?.cached_tokens ?? 0, output: u.completion_tokens ?? 0 },
    }
  } finally {
    clearTimeout(timer)
  }
}

// DeepSeek speaks the OpenAI chat-completions protocol. JSON mode needs
// the word "json" in the prompt, which the system suffix provides.
async function deepseek(req: LlmRequest, key: string, base: string, defaultModel?: string): Promise<ProviderResult> {
  const model = req.model && req.model.startsWith('deepseek') ? req.model : defaultModel || 'deepseek-flash'
  const call = async (jsonMode: boolean): Promise<ProviderResult> => {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), req.timeoutMs ?? 20_000)
    try {
      const res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model,
          temperature: req.temperature ?? 0.3,
          max_tokens: 2048,
          ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
          messages: [
            {
              role: 'system',
              content: `${req.system}\n\nRespond with a single valid json object only${jsonMode ? '' : ' (no prose, no code fences)'}.`,
            },
            ...req.turns,
          ],
        }),
      })
      if (!res.ok) throw new Error(`DeepSeek ${res.status}: ${await res.text()}`)
      const data = await res.json()
      const u = data.usage ?? {}
      return {
        text: data.choices?.[0]?.message?.content ?? '',
        model: data.model ?? model,
        usage: { input: u.prompt_tokens ?? 0, cachedInput: u.prompt_cache_hit_tokens ?? 0, output: u.completion_tokens ?? 0 },
      }
    } finally {
      clearTimeout(timer)
    }
  }
  // DeepSeek's JSON mode occasionally returns empty/whitespace content (a
  // documented quirk). Retry once without JSON mode; the caller parses
  // the object out of the text.
  const first = await call(true)
  if (first.text.trim()) return first
  console.warn('[ai] deepseek returned empty JSON-mode content; retrying without json mode')
  const second = await call(false)
  if (!second.text.trim()) throw new Error('DeepSeek returned empty content')
  return {
    ...second,
    usage: {
      input: first.usage.input + second.usage.input,
      cachedInput: first.usage.cachedInput + second.usage.cachedInput,
      output: first.usage.output + second.usage.output,
    },
  }
}

function providerForModel(model: string | null | undefined): AiProvider | null {
  if (!model) return null
  if (model.startsWith('gemini')) return 'gemini'
  if (model.startsWith('deepseek')) return 'deepseek'
  if (/^(gpt|o\d)/.test(model)) return 'openai'
  return null
}

/** Providers with a key, in the order they'll be tried. */
export function providerOrder(cfg: AiConfig, model?: string | null): AiProvider[] {
  const order = [...cfg.order]
  const preferred = providerForModel(model)
  if (preferred) order.sort((a, b) => (a === preferred ? -1 : b === preferred ? 1 : 0))
  return order.filter((p) => !!cfg.keys[p])
}

export async function llmConfigured(): Promise<boolean> {
  return providerOrder(await getAiConfig()).length > 0
}

/** One provider only (admin "test connection"). */
export async function pingProvider(provider: AiProvider, cfg?: AiConfig): Promise<string> {
  const config = cfg ?? (await getAiConfig())
  return completeJson(
    {
      system: 'You are a health check. Reply with {"ok": true}.',
      turns: [{ role: 'user', content: 'ping' }],
      schema: { type: 'OBJECT', properties: { ok: { type: 'BOOLEAN' } }, required: ['ok'] },
      timeoutMs: 15_000,
    },
    { ...config, order: [provider] },
  )
}

async function recordUsage(meter: UsageMeter, provider: AiProvider, result: ProviderResult, latencyMs: number) {
  try {
    const overrides = await getPlatformSetting<Record<string, ModelPrice>>('ai_pricing')
    const cost = costUsd(result.usage, priceFor(provider, result.model, overrides))
    // Lazy: keeps this module importable without a database (pure tests).
    const { tenantDb } = await import('@/lib/db/tenant')
    await tenantDb(meter.workspaceId).ai_usage.create({ data: {
      workspace_id: meter.workspaceId,
      ai_agent_id: meter.aiAgentId ?? null,
      conversation_id: meter.conversationId ?? null,
      channel_id: meter.channelId ?? null,
      purpose: meter.purpose,
      provider,
      model: result.model,
      input_tokens: result.usage.input,
      cached_input_tokens: result.usage.cachedInput,
      output_tokens: result.usage.output,
      ...(result.usage.audioSeconds ? { audio_seconds: Math.round(result.usage.audioSeconds * 100) / 100 } : {}),
      cost_usd: cost,
      latency_ms: latencyMs,
    } })
  } catch (err) {
    // Metering must never break a customer reply.
    console.error('[ai] usage metering failed:', err instanceof Error ? err.message : err)
  }
}

/** Returns the raw JSON text from the first provider that answers. */
export async function completeJson(req: LlmRequest, cfg?: AiConfig): Promise<string> {
  const config = cfg ?? (await getAiConfig())
  const errors: string[] = []
  for (const provider of providerOrder(config, req.model)) {
    const key = config.keys[provider]!
    const started = Date.now()
    try {
      let result: ProviderResult
      if (provider === 'gemini') {
        if (Date.now() < geminiOpenUntil && config.order.length > 1) continue
        let model = req.model && req.model.startsWith('gemini') ? req.model : config.models.gemini || DEFAULT_GEMINI
        let r = await gemini(model, req, key)
        if (!r.ok && (r.status === 503 || r.status === 429)) {
          model = BACKUP_GEMINI
          r = await gemini(model, req, key)
        }
        if (!r.ok || !r.text) {
          if (r.status === 404 || /"limit":\s*0/.test(r.text)) geminiOpenUntil = Date.now() + CIRCUIT_MS
          throw new Error(`Gemini ${r.status}: ${r.text.slice(0, 200)}`)
        }
        result = { text: r.text, model, usage: r.usage }
      } else if (provider === 'deepseek') {
        result = await deepseek(req, key, config.deepseekBaseUrl, config.models.deepseek)
      } else {
        result = await openai(req, key, config.models.openai)
      }
      if (req.meter) await recordUsage(req.meter, provider, result, Date.now() - started)
      if (!result.text.trim()) throw new Error('empty completion')
      return result.text
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`${provider}: ${msg.slice(0, 200)}`)
      console.warn(`[ai] ${provider} failed; trying next provider:`, msg.slice(0, 200))
    }
  }
  throw new LlmUnavailableError(
    errors.length
      ? `All AI providers failed (${errors.join(' | ')})`
      : 'No AI provider configured (add an API key in the admin panel or set GEMINI_API_KEY, DEEPSEEK_API_KEY or OPENAI_API_KEY)',
  )
}

/** Lenient JSON parse: strips code fences and trailing text. */
export function parseJsonLoose<T>(text: string): T | null {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
  try {
    return JSON.parse(cleaned) as T
  } catch {
    const start = cleaned.indexOf('{')
    const end = cleaned.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1)) as T
      } catch {
        return null
      }
    }
    return null
  }
}

// ------------------------------------------------------------
// Multimodal: audio transcription and image / PDF reading
// ------------------------------------------------------------
// Gemini (generateContent with inline_data, or the Files API above the
// inline limit) and OpenAI (/audio/transcriptions multipart; vision and
// PDFs through chat completions content parts). DeepSeek is text-only,
// so a DeepSeek-only platform gets MediaAiUnavailableError.

export type MediaAiReason = 'no_provider' | 'unsupported_type' | 'too_large' | 'failed'

export class MediaAiUnavailableError extends Error {
  constructor(
    public reason: MediaAiReason,
    message?: string,
  ) {
    super(message ?? reason)
    this.name = 'MediaAiUnavailableError'
  }
}

export type MediaModality = 'audio' | 'vision'

export interface MediaResult {
  text: string
  provider: AiProvider
  model: string
}

/** Max media we hand to a model (also the download cap). */
export const MAX_MEDIA_BYTES = 20 * 1024 * 1024
/** Gemini's inline request limit is 20 MB including base64 overhead (×4/3) and the prompt. */
export const GEMINI_INLINE_MAX_BYTES = 14 * 1024 * 1024
/** OpenAI /audio/transcriptions accepts files up to 25 MB. */
const OPENAI_AUDIO_MAX_BYTES = 25 * 1024 * 1024
const DEFAULT_OPENAI_TRANSCRIBE = 'gpt-4o-mini-transcribe'

const isOpenRouterKey = (key: string | undefined) => !!key && key.startsWith('sk-or-')

/** Providers able to handle a modality, in the configured order. */
export function mediaProviders(cfg: AiConfig, modality: MediaModality): AiProvider[] {
  return cfg.order.filter((p) => {
    const key = cfg.keys[p]
    if (!key) return false
    if (p === 'gemini') return true
    // OpenRouter exposes chat completions (vision) but not /audio/transcriptions.
    if (p === 'openai') return modality === 'vision' || !isOpenRouterKey(key)
    return false // deepseek: text only
  })
}

export async function mediaCapabilities(cfg?: AiConfig): Promise<{ text: boolean; audio: boolean; vision: boolean }> {
  const config = cfg ?? (await getAiConfig())
  return {
    text: providerOrder(config).length > 0,
    audio: mediaProviders(config, 'audio').length > 0,
    vision: mediaProviders(config, 'vision').length > 0,
  }
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64')
}

function withTimeout(ms: number): { signal: AbortSignal; done: () => void } {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  return { signal: ctrl.signal, done: () => clearTimeout(timer) }
}

/** Gemini wants a few canonical audio types. */
function geminiMime(mime: string): string {
  const m = normalizeMime(mime)
  if (m === 'video/ogg' || m === 'audio/opus') return 'audio/ogg'
  if (m === 'audio/mp4') return 'audio/m4a'
  return m
}

interface GeminiFile {
  name: string
  uri: string
  mimeType: string
}

/** Resumable upload to the Gemini Files API (files are deleted after use, 48 h at most). */
async function geminiUpload(bytes: Uint8Array, mime: string, key: string, signal: AbortSignal): Promise<GeminiFile> {
  const base = providerBases().gemini
  const start = await fetch(`${base}/upload/v1beta/files`, {
    method: 'POST',
    signal,
    headers: {
      'x-goog-api-key': key,
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(bytes.byteLength),
      'X-Goog-Upload-Header-Content-Type': mime,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ file: { display_name: `chat-media-${Date.now()}` } }),
  })
  const uploadUrl = start.headers.get('x-goog-upload-url')
  if (!start.ok || !uploadUrl) throw new Error(`Gemini upload start ${start.status}`)
  const up = await fetch(uploadUrl, {
    method: 'POST',
    signal,
    headers: { 'Content-Length': String(bytes.byteLength), 'X-Goog-Upload-Offset': '0', 'X-Goog-Upload-Command': 'upload, finalize' },
    body: Uint8Array.from(bytes),
  })
  if (!up.ok) throw new Error(`Gemini upload ${up.status}`)
  const info = (await up.json()) as { file?: { name?: string; uri?: string; mimeType?: string; state?: string } }
  let file = info.file
  if (!file?.name || !file.uri) throw new Error('Gemini upload returned no file')
  // Audio / PDFs may need a moment of processing before they can be used.
  for (let i = 0; i < 10 && file?.state === 'PROCESSING'; i++) {
    await new Promise((r) => setTimeout(r, 1000))
    const st: Response = await fetch(`${base}/v1beta/${file.name}`, { signal, headers: { 'x-goog-api-key': key } })
    if (!st.ok) break
    file = { ...file, ...((await st.json()) as typeof file) }
  }
  if (file?.state === 'FAILED') throw new Error('Gemini file processing failed')
  return { name: file!.name!, uri: file!.uri!, mimeType: file!.mimeType || mime }
}

async function geminiMedia(
  key: string,
  model: string,
  input: { bytes: Uint8Array; mimeType: string; prompt: string; maxOutputTokens: number; timeoutMs: number },
): Promise<{ ok: boolean; status: number; text: string; usage: TokenUsage; body: string }> {
  const { signal, done } = withTimeout(input.timeoutMs)
  const mime = geminiMime(input.mimeType)
  let uploaded: GeminiFile | null = null
  try {
    const mediaPart =
      input.bytes.byteLength <= GEMINI_INLINE_MAX_BYTES
        ? { inline_data: { mime_type: mime, data: toBase64(input.bytes) } }
        : await geminiUpload(input.bytes, mime, key, signal).then((f) => {
            uploaded = f
            return { file_data: { mime_type: f.mimeType, file_uri: f.uri } }
          })
    const res = await fetch(`${providerBases().gemini}/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: input.prompt }, mediaPart] }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: input.maxOutputTokens,
          // 2.5 Flash thinks by default; transcription / description doesn't need it.
          ...(/2\.5-flash/.test(model) ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
        },
      }),
    })
    const body = await res.text()
    if (!res.ok) return { ok: false, status: res.status, text: '', usage: noUsage(), body }
    const data = JSON.parse(body)
    const parts = (data.candidates?.[0]?.content?.parts ?? []) as { text?: string; thought?: boolean }[]
    const text = parts
      .filter((p) => !p.thought)
      .map((p) => p.text ?? '')
      .join('')
      .trim()
    const u = data.usageMetadata ?? {}
    const details = (u.promptTokensDetails ?? []) as { modality?: string; tokenCount?: number }[]
    return {
      ok: true,
      status: 200,
      text,
      body,
      usage: {
        input: u.promptTokenCount ?? 0,
        cachedInput: u.cachedContentTokenCount ?? 0,
        output: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0),
        audioInput: details.filter((d) => d.modality === 'AUDIO').reduce((n, d) => n + (d.tokenCount ?? 0), 0),
      },
    }
  } finally {
    done()
    const f = uploaded as GeminiFile | null
    if (f) {
      fetch(`${providerBases().gemini}/v1beta/${f.name}`, { method: 'DELETE', headers: { 'x-goog-api-key': key } }).catch(() => {})
    }
  }
}

/** Gemini with the configured model, falling back to the backup model when overloaded. */
async function geminiMediaWithBackup(
  cfg: AiConfig,
  input: Parameters<typeof geminiMedia>[2],
): Promise<ProviderResult> {
  let model = cfg.models.gemini || DEFAULT_GEMINI
  let r = await geminiMedia(cfg.keys.gemini!, model, input)
  if (!r.ok && (r.status === 503 || r.status === 429) && model !== BACKUP_GEMINI) {
    model = BACKUP_GEMINI
    r = await geminiMedia(cfg.keys.gemini!, model, input)
  }
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${r.body.slice(0, 200)}`)
  return { text: r.text, model, usage: r.usage }
}

async function openaiTranscribe(
  key: string,
  input: { bytes: Uint8Array; mimeType: string; language?: string | null; prompt?: string; timeoutMs: number },
): Promise<ProviderResult> {
  if (input.bytes.byteLength > OPENAI_AUDIO_MAX_BYTES) throw new MediaAiUnavailableError('too_large')
  const model = process.env.OPENAI_TRANSCRIBE_MODEL || DEFAULT_OPENAI_TRANSCRIBE
  const form = new FormData()
  form.append('file', new Blob([Uint8Array.from(input.bytes)], { type: normalizeMime(input.mimeType) }), audioFileName(input.mimeType))
  form.append('model', model)
  form.append('response_format', 'json')
  // gpt-transcribe takes `languages` instead; the others an ISO-639-1 `language`.
  if (input.language && model !== 'gpt-transcribe') form.append('language', input.language)
  if (input.prompt && model !== 'gpt-4o-transcribe-diarize') form.append('prompt', input.prompt)
  const { signal, done } = withTimeout(input.timeoutMs)
  try {
    const res = await fetch(`${providerBases().openai}/audio/transcriptions`, {
      method: 'POST',
      signal,
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    })
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 200)}`)
    const data = (await res.json()) as {
      text?: string
      usage?: { type?: string; input_tokens?: number; output_tokens?: number; seconds?: number; input_token_details?: { audio_tokens?: number } }
    }
    const u = data.usage ?? {}
    const usage: TokenUsage =
      u.type === 'duration'
        ? { input: 0, cachedInput: 0, output: 0, audioSeconds: u.seconds ?? 0 }
        : {
            input: u.input_tokens ?? 0,
            cachedInput: 0,
            output: u.output_tokens ?? 0,
            audioInput: u.input_token_details?.audio_tokens ?? u.input_tokens ?? 0,
          }
    return { text: (data.text ?? '').trim(), model, usage }
  } finally {
    done()
  }
}

async function openaiVision(
  key: string,
  defaultModel: string | undefined,
  input: { bytes: Uint8Array; mimeType: string; prompt: string; maxOutputTokens: number; timeoutMs: number },
): Promise<ProviderResult> {
  const viaOpenRouter = isOpenRouterKey(key)
  const model = defaultModel && /^(gpt|o\d)/.test(defaultModel) ? defaultModel : 'gpt-4o-mini'
  const mime = normalizeMime(input.mimeType)
  const dataUrl = `data:${mime};base64,${toBase64(input.bytes)}`
  const mediaPart =
    mime === 'application/pdf'
      ? { type: 'file', file: { filename: 'document.pdf', file_data: dataUrl } }
      : { type: 'image_url', image_url: { url: dataUrl } }
  const bases = providerBases()
  const { signal, done } = withTimeout(input.timeoutMs)
  try {
    const res = await fetch(`${viaOpenRouter ? bases.openrouter : bases.openai}/chat/completions`, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
        ...(viaOpenRouter ? { 'HTTP-Referer': process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3001', 'X-Title': 'Whasalia' } : {}),
      },
      body: JSON.stringify({
        model: viaOpenRouter ? `openai/${model}` : model,
        temperature: 0.1,
        max_tokens: input.maxOutputTokens,
        messages: [{ role: 'user', content: [{ type: 'text', text: input.prompt }, mediaPart] }],
      }),
    })
    if (!res.ok) throw new Error(`${viaOpenRouter ? 'OpenRouter' : 'OpenAI'} ${res.status}: ${(await res.text()).slice(0, 200)}`)
    const data = await res.json()
    const u = data.usage ?? {}
    return {
      text: String(data.choices?.[0]?.message?.content ?? '').trim(),
      model,
      usage: { input: u.prompt_tokens ?? 0, cachedInput: u.prompt_tokens_details?.cached_tokens ?? 0, output: u.completion_tokens ?? 0 },
    }
  } finally {
    done()
  }
}

const LANGUAGE_NAMES: Record<string, string> = { es: 'Spanish', en: 'English', pt: 'Portuguese' }

export interface TranscribeInput {
  bytes: Uint8Array
  mimeType: string
  /** ISO-639-1 hint ("es"); the transcript keeps the spoken language. */
  language?: string | null
  meter: UsageMeter
  timeoutMs?: number
}

/** Speech → text with the first configured provider that handles audio. */
export async function transcribeAudio(input: TranscribeInput, cfg?: AiConfig): Promise<MediaResult> {
  const config = cfg ?? (await getAiConfig())
  const mime = normalizeMime(input.mimeType)
  if (mediaKindOf(mime) !== 'audio') throw new MediaAiUnavailableError('unsupported_type', `Not audio: ${mime}`)
  if (input.bytes.byteLength > MAX_MEDIA_BYTES) throw new MediaAiUnavailableError('too_large')
  const providers = mediaProviders(config, 'audio')
  if (!providers.length) throw new MediaAiUnavailableError('no_provider', 'No AI provider for audio (configure Gemini or OpenAI)')
  const timeoutMs = input.timeoutMs ?? 20_000
  const lang = input.language ? LANGUAGE_NAMES[input.language] : null
  const prompt = [
    'Transcribe this voice message verbatim, in the language it is spoken.',
    lang ? `It is most likely in ${lang}.` : '',
    'Return only the transcript as plain text: no timestamps, speaker labels, quotes or comments.',
    'If there is no intelligible speech, return an empty response.',
  ]
    .filter(Boolean)
    .join(' ')
  const errors: string[] = []
  for (const provider of providers) {
    const started = Date.now()
    try {
      const result =
        provider === 'gemini'
          ? await geminiMediaWithBackup(config, { bytes: input.bytes, mimeType: mime, prompt, maxOutputTokens: 2048, timeoutMs })
          : await openaiTranscribe(config.keys.openai!, { bytes: input.bytes, mimeType: mime, language: input.language, timeoutMs })
      await recordUsage(input.meter, provider, result, Date.now() - started)
      return { text: result.text, provider, model: result.model }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`${provider}: ${msg.slice(0, 200)}`)
      console.warn(`[ai] ${provider} transcription failed:`, msg.slice(0, 200))
    }
  }
  throw new MediaAiUnavailableError('failed', `Transcription failed (${errors.join(' | ')})`)
}

export interface DescribeInput {
  bytes?: Uint8Array
  /** Public https URL, fetched with SSRF protection when `bytes` is absent. */
  url?: string
  mimeType?: string
  prompt: string
  meter: UsageMeter
  maxOutputTokens?: number
  timeoutMs?: number
}

/** Image / PDF → text (description or extracted content) per `prompt`. */
export async function describeMedia(input: DescribeInput, cfg?: AiConfig): Promise<MediaResult> {
  const config = cfg ?? (await getAiConfig())
  const providers = mediaProviders(config, 'vision')
  if (!providers.length) throw new MediaAiUnavailableError('no_provider', 'No AI provider for images/PDFs (configure Gemini or OpenAI)')
  let bytes = input.bytes
  let declared = input.mimeType
  if (!bytes) {
    if (!input.url) throw new MediaAiUnavailableError('unsupported_type', 'bytes or url required')
    const { safeFetch } = await import('@/lib/net/safe-fetch')
    const got = await safeFetch(input.url, { maxBytes: MAX_MEDIA_BYTES, timeoutMs: 15_000 }).catch((e) => {
      throw new MediaAiUnavailableError(e?.code === 'too_large' ? 'too_large' : 'failed', `Download failed: ${e instanceof Error ? e.message : e}`)
    })
    bytes = got.bytes
    declared = declared || got.contentType
  }
  if (bytes.byteLength > MAX_MEDIA_BYTES) throw new MediaAiUnavailableError('too_large')
  const mime = resolveMime(declared, bytes)
  const kind = mediaKindOf(mime)
  if (kind !== 'image' && kind !== 'pdf') throw new MediaAiUnavailableError('unsupported_type', `Not an image or PDF: ${mime}`)
  const timeoutMs = input.timeoutMs ?? 30_000
  const maxOutputTokens = input.maxOutputTokens ?? 1024
  const errors: string[] = []
  for (const provider of providers) {
    if (provider === 'openai' && kind === 'image' && !OPENAI_IMAGE_TYPES.has(mime)) continue
    const started = Date.now()
    try {
      const result =
        provider === 'gemini'
          ? await geminiMediaWithBackup(config, { bytes, mimeType: mime, prompt: input.prompt, maxOutputTokens, timeoutMs })
          : await openaiVision(config.keys.openai!, config.models.openai, { bytes, mimeType: mime, prompt: input.prompt, maxOutputTokens, timeoutMs })
      await recordUsage(input.meter, provider, result, Date.now() - started)
      if (!result.text) throw new Error('empty response')
      return { text: result.text, provider, model: result.model }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`${provider}: ${msg.slice(0, 200)}`)
      console.warn(`[ai] ${provider} vision failed:`, msg.slice(0, 200))
    }
  }
  throw new MediaAiUnavailableError(errors.length ? 'failed' : 'unsupported_type', errors.length ? `Vision failed (${errors.join(' | ')})` : `No provider accepts ${mime}`)
}

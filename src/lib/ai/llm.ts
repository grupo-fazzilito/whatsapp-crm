import 'server-only'
import { getAiConfig, getPlatformSetting, type AiConfig, type AiProvider } from '@/lib/platform/settings'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { costUsd, priceFor, type ModelPrice, type TokenUsage } from './pricing'

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

const DEFAULT_GEMINI = 'gemini-2.5-flash'
const BACKUP_GEMINI = 'gemini-2.0-flash'
const CIRCUIT_MS = 60_000
let geminiOpenUntil = 0

async function gemini(model: string, req: LlmRequest, key: string): Promise<{ ok: boolean; status: number; text: string; usage: TokenUsage }> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), req.timeoutMs ?? 12_000)
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
  const url = viaOpenRouter ? 'https://openrouter.ai/api/v1/chat/completions' : 'https://api.openai.com/v1/chat/completions'
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
          ? { 'HTTP-Referer': process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3001', 'X-Title': 'ChatNexGen' }
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
    await supabaseAdmin().from('ai_usage').insert({
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
      cost_usd: cost,
      latency_ms: latencyMs,
    })
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

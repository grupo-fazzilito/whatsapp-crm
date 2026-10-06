import 'server-only'
import { getAiConfig, type AiConfig, type AiProvider } from '@/lib/platform/settings'

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
}

export class LlmUnavailableError extends Error {}

const DEFAULT_GEMINI = 'gemini-2.5-flash'
const BACKUP_GEMINI = 'gemini-2.0-flash'
const CIRCUIT_MS = 60_000
let geminiOpenUntil = 0

async function gemini(model: string, req: LlmRequest, key: string): Promise<{ ok: boolean; status: number; text: string }> {
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
    if (!res.ok) return { ok: false, status: res.status, text: body }
    const data = JSON.parse(body)
    return { ok: true, status: 200, text: data.candidates?.[0]?.content?.parts?.[0]?.text ?? '' }
  } finally {
    clearTimeout(timer)
  }
}

async function openai(req: LlmRequest, key: string, defaultModel?: string): Promise<string> {
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
    return content
  } finally {
    clearTimeout(timer)
  }
}

// DeepSeek speaks the OpenAI chat-completions protocol. JSON mode needs
// the word "json" in the prompt, which the system suffix provides.
async function deepseek(req: LlmRequest, key: string, base: string, defaultModel?: string): Promise<string> {
  const model = req.model && req.model.startsWith('deepseek') ? req.model : defaultModel || 'deepseek-chat'
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
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: `${req.system}\n\nRespond with a single valid json object only.` },
          ...req.turns,
        ],
      }),
    })
    if (!res.ok) throw new Error(`DeepSeek ${res.status}: ${await res.text()}`)
    const data = await res.json()
    const content = data.choices?.[0]?.message?.content
    if (!content) throw new Error('Empty completion')
    return content
  } finally {
    clearTimeout(timer)
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

/** Returns the raw JSON text from the first provider that answers. */
export async function completeJson(req: LlmRequest, cfg?: AiConfig): Promise<string> {
  const config = cfg ?? (await getAiConfig())
  const errors: string[] = []
  for (const provider of providerOrder(config, req.model)) {
    const key = config.keys[provider]!
    try {
      if (provider === 'gemini') {
        if (Date.now() < geminiOpenUntil && config.order.length > 1) continue
        const primary = req.model && req.model.startsWith('gemini') ? req.model : config.models.gemini || DEFAULT_GEMINI
        let r = await gemini(primary, req, key)
        if (!r.ok && (r.status === 503 || r.status === 429)) r = await gemini(BACKUP_GEMINI, req, key)
        if (r.ok && r.text) return r.text
        if (r.status === 404 || /"limit":\s*0/.test(r.text)) geminiOpenUntil = Date.now() + CIRCUIT_MS
        throw new Error(`Gemini ${r.status}: ${r.text.slice(0, 200)}`)
      }
      if (provider === 'deepseek') return await deepseek(req, key, config.deepseekBaseUrl, config.models.deepseek)
      return await openai(req, key, config.models.openai)
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

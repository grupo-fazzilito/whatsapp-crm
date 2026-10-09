// Provider prices in USD per 1M tokens, used to cost each model call
// (ai_usage.cost_usd). Defaults below come from the providers' public
// price pages (Oct 2026; DeepSeek at peak rates to stay conservative;
// audio/transcription rates checked against ai.google.dev/gemini-api/docs/pricing
// and developers.openai.com/api/docs/pricing);
// the platform admin can override them in platform_settings 'ai_pricing'.

export interface ModelPrice {
  input: number
  cachedInput: number
  output: number
  /** Audio input tokens, when billed differently from text (Gemini: $1/M on 2.5 Flash). */
  audioInput?: number
  /**
   * USD per minute of audio, for models billed by duration (OpenAI
   * whisper-1 / gpt-transcribe). Applied to usage.audioSeconds, which is
   * only set when the provider reported a duration instead of tokens.
   */
  perMinute?: number
}

export const DEFAULT_PRICES: Record<string, ModelPrice> = {
  'gemini-2.5-flash': { input: 0.3, cachedInput: 0.03, output: 2.5, audioInput: 1 },
  'gemini-2.0-flash': { input: 0.1, cachedInput: 0.025, output: 0.4 },
  'gemini-2.5-flash-lite': { input: 0.1, cachedInput: 0.01, output: 0.4, audioInput: 0.3 },
  'gemini-2.5-pro': { input: 1.25, cachedInput: 0.125, output: 10 },
  'deepseek-flash': { input: 0.3, cachedInput: 0.006, output: 1.2 },
  'deepseek-v4-pro': { input: 1.32, cachedInput: 0.044, output: 3.96 },
  'gpt-4o-mini': { input: 0.15, cachedInput: 0.075, output: 0.6 },
  'gpt-4o': { input: 2.5, cachedInput: 1.25, output: 10 },
  'gpt-4.1-mini': { input: 0.4, cachedInput: 0.1, output: 1.6 },
  // Speech-to-text. Token-billed models report audio tokens (input) and
  // text tokens (output); the per-minute figure is OpenAI's published
  // estimate, used only when the response reports a duration instead.
  'gpt-4o-mini-transcribe': { input: 1.25, cachedInput: 0, output: 5, audioInput: 1.25, perMinute: 0.003 },
  'gpt-4o-transcribe': { input: 2.5, cachedInput: 0, output: 10, audioInput: 2.5, perMinute: 0.006 },
  'gpt-transcribe': { input: 0, cachedInput: 0, output: 0, perMinute: 0.0045 },
  'whisper-1': { input: 0, cachedInput: 0, output: 0, perMinute: 0.006 },
}

/** Fallback per provider when a model isn't in the table. */
const PROVIDER_FALLBACK: Record<string, string> = {
  gemini: 'gemini-2.5-flash',
  deepseek: 'deepseek-flash',
  openai: 'gpt-4o-mini',
}

export interface TokenUsage {
  input: number
  cachedInput: number
  output: number
  /** Part of `input` that was audio (billed at ModelPrice.audioInput). */
  audioInput?: number
  /** Seconds of audio billed by duration (ModelPrice.perMinute). */
  audioSeconds?: number
}

export function priceFor(provider: string, model: string, overrides?: Record<string, ModelPrice> | null): ModelPrice {
  const table = { ...DEFAULT_PRICES, ...(overrides ?? {}) }
  const bare = model.replace(/^openai\//, '')
  return table[bare] ?? table[PROVIDER_FALLBACK[provider] ?? ''] ?? { input: 0, cachedInput: 0, output: 0 }
}

/**
 * Cost in USD. Cached input is billed at the cached rate, audio input at
 * the audio rate (falling back to the input rate), the rest at the input
 * rate; audio billed by duration adds seconds/60 × perMinute.
 */
export function costUsd(usage: TokenUsage, price: ModelPrice): number {
  const audio = Math.max(0, Math.min(usage.audioInput ?? 0, usage.input - usage.cachedInput))
  const uncached = Math.max(0, usage.input - usage.cachedInput - audio)
  const tokens =
    (uncached * price.input + audio * (price.audioInput ?? price.input) + usage.cachedInput * price.cachedInput + usage.output * price.output) /
    1_000_000
  const minutes = (usage.audioSeconds ?? 0) / 60
  return tokens + minutes * (price.perMinute ?? 0)
}

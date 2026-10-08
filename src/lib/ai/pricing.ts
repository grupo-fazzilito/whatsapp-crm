// Provider prices in USD per 1M tokens, used to cost each model call
// (ai_usage.cost_usd). Defaults below come from the providers' public
// price pages (Oct 2026; DeepSeek at peak rates to stay conservative);
// the platform admin can override them in platform_settings 'ai_pricing'.

export interface ModelPrice {
  input: number
  cachedInput: number
  output: number
}

export const DEFAULT_PRICES: Record<string, ModelPrice> = {
  'gemini-2.5-flash': { input: 0.3, cachedInput: 0.03, output: 2.5 },
  'gemini-2.0-flash': { input: 0.1, cachedInput: 0.025, output: 0.4 },
  'gemini-2.5-pro': { input: 1.25, cachedInput: 0.125, output: 10 },
  'deepseek-flash': { input: 0.3, cachedInput: 0.006, output: 1.2 },
  'deepseek-v4-pro': { input: 1.32, cachedInput: 0.044, output: 3.96 },
  'gpt-4o-mini': { input: 0.15, cachedInput: 0.075, output: 0.6 },
  'gpt-4o': { input: 2.5, cachedInput: 1.25, output: 10 },
  'gpt-4.1-mini': { input: 0.4, cachedInput: 0.1, output: 1.6 },
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
}

export function priceFor(provider: string, model: string, overrides?: Record<string, ModelPrice> | null): ModelPrice {
  const table = { ...DEFAULT_PRICES, ...(overrides ?? {}) }
  const bare = model.replace(/^openai\//, '')
  return table[bare] ?? table[PROVIDER_FALLBACK[provider] ?? ''] ?? { input: 0, cachedInput: 0, output: 0 }
}

/** Cost in USD. Cached input is billed at the cached rate, the rest at the input rate. */
export function costUsd(usage: TokenUsage, price: ModelPrice): number {
  const uncached = Math.max(0, usage.input - usage.cachedInput)
  return (uncached * price.input + usage.cachedInput * price.cachedInput + usage.output * price.output) / 1_000_000
}

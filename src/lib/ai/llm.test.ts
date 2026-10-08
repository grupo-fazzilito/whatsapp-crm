import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
// Panel settings are read from the DB; tests pass configs explicitly.
vi.mock('@/lib/platform/settings', async (orig) => {
  const real = await orig<typeof import('@/lib/platform/settings')>()
  return { ...real, getAiConfig: vi.fn(async () => real.buildAiConfig(null, {})) }
})

import { buildAiConfig } from '@/lib/platform/settings'
import { encrypt } from '@/lib/whatsapp/encryption'
import { completeJson, LlmUnavailableError, providerOrder } from './llm'

afterEach(() => vi.unstubAllGlobals())

const req = { system: 'sys', turns: [{ role: 'user' as const, content: 'hola' }], schema: {} }
const chatResponse = (content: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 })

describe('buildAiConfig', () => {
  it('panel keys win over env; env is the fallback', () => {
    const cfg = buildAiConfig(
      { keys: { deepseek: encrypt('ds-panel') } },
      { DEEPSEEK_API_KEY: 'ds-env', OPENAI_API_KEY: 'oa-env' },
    )
    expect(cfg.keys).toEqual({ deepseek: 'ds-panel', openai: 'oa-env' })
    expect(cfg.sources).toEqual({ deepseek: 'panel', openai: 'env' })
  })

  it('order: panel > AI_PROVIDER_ORDER env > default, always complete', () => {
    expect(buildAiConfig(null, {}).order).toEqual(['gemini', 'deepseek', 'openai'])
    expect(buildAiConfig(null, { AI_PROVIDER_ORDER: 'openai' }).order).toEqual(['openai', 'gemini', 'deepseek'])
    expect(buildAiConfig({ provider_order: ['deepseek'] }, { AI_PROVIDER_ORDER: 'openai' }).order).toEqual([
      'deepseek',
      'gemini',
      'openai',
    ])
  })
})

describe('providerOrder', () => {
  const cfg = buildAiConfig({ provider_order: ['openai', 'deepseek', 'gemini'] }, { GEMINI_API_KEY: 'g', DEEPSEEK_API_KEY: 'd', OPENAI_API_KEY: 'o' })
  it('keeps only providers with a key', () => {
    expect(providerOrder(buildAiConfig(null, { DEEPSEEK_API_KEY: 'd' }))).toEqual(['deepseek'])
  })
  it("moves the agent model's provider first", () => {
    expect(providerOrder(cfg)).toEqual(['openai', 'deepseek', 'gemini'])
    expect(providerOrder(cfg, 'deepseek-flash')).toEqual(['deepseek', 'openai', 'gemini'])
  })
})

describe('completeJson', () => {
  it('calls DeepSeek chat completions in JSON mode with the configured model and base URL', async () => {
    const cfg = buildAiConfig({ models: { deepseek: 'deepseek-flash' }, deepseek_base_url: 'https://ds.example/' }, { DEEPSEEK_API_KEY: 'ds-key' })
    const fetchMock = vi.fn().mockResolvedValue(chatResponse('{"reply":"ok"}'))
    vi.stubGlobal('fetch', fetchMock)

    await expect(completeJson(req, cfg)).resolves.toBe('{"reply":"ok"}')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://ds.example/chat/completions')
    expect(init.headers.Authorization).toBe('Bearer ds-key')
    const body = JSON.parse(init.body)
    expect(body.model).toBe('deepseek-flash')
    expect(body.response_format).toEqual({ type: 'json_object' })
    expect(body.messages[0].content).toMatch(/json/i)
    expect(body.messages[1]).toEqual({ role: 'user', content: 'hola' })
  })

  it('falls back to the next provider when one fails', async () => {
    const cfg = buildAiConfig(null, { DEEPSEEK_API_KEY: 'd', OPENAI_API_KEY: 'o' })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('overloaded', { status: 503 }))
      .mockResolvedValueOnce(chatResponse('{"reply":"from openai"}'))
    vi.stubGlobal('fetch', fetchMock)

    await expect(completeJson(req, cfg)).resolves.toBe('{"reply":"from openai"}')
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.openai.com/v1/chat/completions')
  })

  it('throws LlmUnavailableError when nothing is configured', async () => {
    await expect(completeJson(req, buildAiConfig(null, {}))).rejects.toBeInstanceOf(LlmUnavailableError)
  })
})

describe('usage metering', () => {
  it('costs a call from the provider-reported tokens (cached input at the cached rate)', async () => {
    const { costUsd, priceFor } = await import('./pricing')
    const price = priceFor('deepseek', 'deepseek-flash')
    // 5,000 input (1,000 cached) + 250 output
    const cost = costUsd({ input: 5000, cachedInput: 1000, output: 250 }, price)
    expect(cost).toBeCloseTo((4000 * 0.3 + 1000 * 0.006 + 250 * 1.2) / 1e6, 10)
    // Unknown model falls back to the provider default; panel overrides win.
    expect(priceFor('gemini', 'gemini-9-ultra')).toEqual(priceFor('gemini', 'gemini-2.5-flash'))
    expect(priceFor('openai', 'openai/gpt-4o-mini', { 'gpt-4o-mini': { input: 1, cachedInput: 1, output: 1 } }).input).toBe(1)
  })

  it('reads DeepSeek usage incl. cache hits from the response', async () => {
    const cfg = buildAiConfig(null, { DEEPSEEK_API_KEY: 'd' })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            model: 'deepseek-flash',
            choices: [{ message: { content: '{"reply":"hola"}' } }],
            usage: { prompt_tokens: 5000, prompt_cache_hit_tokens: 4000, completion_tokens: 200 },
          }),
          { status: 200 },
        ),
      ),
    )
    // No meter → nothing recorded, but the call must still succeed.
    await expect(completeJson(req, cfg)).resolves.toBe('{"reply":"hola"}')
  })
})

describe('DeepSeek empty JSON-mode content', () => {
  it('retries without json mode and returns the second answer', async () => {
    const cfg = buildAiConfig(null, { DEEPSEEK_API_KEY: 'd' })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(chatResponse('   \n  '))
      .mockResolvedValueOnce(chatResponse('Here: {"reply":"ok"}'))
    vi.stubGlobal('fetch', fetchMock)
    await expect(completeJson(req, cfg)).resolves.toBe('Here: {"reply":"ok"}')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).response_format).toEqual({ type: 'json_object' })
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).response_format).toBeUndefined()
  })

  it('moves to the next provider when both attempts are empty', async () => {
    const cfg = buildAiConfig(null, { DEEPSEEK_API_KEY: 'd', OPENAI_API_KEY: 'o' })
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(chatResponse(' '))
        .mockResolvedValueOnce(chatResponse(''))
        .mockResolvedValueOnce(chatResponse('{"reply":"openai"}')),
    )
    await expect(completeJson(req, cfg)).resolves.toBe('{"reply":"openai"}')
  })
})

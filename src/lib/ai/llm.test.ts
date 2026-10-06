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
    expect(providerOrder(cfg, 'deepseek-chat')).toEqual(['deepseek', 'openai', 'gemini'])
  })
})

describe('completeJson', () => {
  it('calls DeepSeek chat completions in JSON mode with the configured model and base URL', async () => {
    const cfg = buildAiConfig({ models: { deepseek: 'deepseek-chat' }, deepseek_base_url: 'https://ds.example/' }, { DEEPSEEK_API_KEY: 'ds-key' })
    const fetchMock = vi.fn().mockResolvedValue(chatResponse('{"reply":"ok"}'))
    vi.stubGlobal('fetch', fetchMock)

    await expect(completeJson(req, cfg)).resolves.toBe('{"reply":"ok"}')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://ds.example/chat/completions')
    expect(init.headers.Authorization).toBe('Bearer ds-key')
    const body = JSON.parse(init.body)
    expect(body.model).toBe('deepseek-chat')
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

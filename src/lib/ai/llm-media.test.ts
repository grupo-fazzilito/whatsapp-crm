import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/platform/settings', async (orig) => {
  const real = await orig<typeof import('@/lib/platform/settings')>()
  return { ...real, getAiConfig: vi.fn(async () => real.buildAiConfig(null, {})), getPlatformSetting: vi.fn(async () => null) }
})
const inserted: Record<string, unknown>[] = []
vi.mock('@/lib/db/tenant', () => ({
  tenantDb: () => ({ ai_usage: { create: async ({ data }: { data: Record<string, unknown> }) => (inserted.push(data), data) } }),
}))

import { buildAiConfig } from '@/lib/platform/settings'
import { describeMedia, mediaProviders, MediaAiUnavailableError, providerBases, transcribeAudio } from './llm'

afterEach(() => {
  vi.unstubAllGlobals()
  inserted.length = 0
})

const OGG = new Uint8Array([0x4f, 0x67, 0x67, 0x53, 1, 2, 3, 4, 5, 6, 7, 8])
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8])
const meter = { workspaceId: 'ws1', purpose: 'transcription' }
const geminiOk = (text: string, audioTokens = 0) =>
  new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text }] } }],
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 10, promptTokensDetails: audioTokens ? [{ modality: 'AUDIO', tokenCount: audioTokens }] : [] },
    }),
    { status: 200 },
  )

describe('provider selection', () => {
  it('Gemini → OpenAI; DeepSeek never handles media; OpenRouter only vision', () => {
    const all = buildAiConfig(null, { GEMINI_API_KEY: 'g', DEEPSEEK_API_KEY: 'd', OPENAI_API_KEY: 'o' })
    expect(mediaProviders(all, 'audio')).toEqual(['gemini', 'openai'])
    expect(mediaProviders(buildAiConfig(null, { DEEPSEEK_API_KEY: 'd' }), 'audio')).toEqual([])
    const or = buildAiConfig(null, { OPENAI_API_KEY: 'sk-or-x' })
    expect(mediaProviders(or, 'audio')).toEqual([])
    expect(mediaProviders(or, 'vision')).toEqual(['openai'])
  })

  it('DeepSeek-only setups get MediaAiUnavailableError(no_provider) without any request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const cfg = buildAiConfig(null, { DEEPSEEK_API_KEY: 'd' })
    const err = await transcribeAudio({ bytes: OGG, mimeType: 'audio/ogg', meter }, cfg).catch((e) => e)
    expect(err).toBeInstanceOf(MediaAiUnavailableError)
    expect(err.reason).toBe('no_provider')
    await expect(describeMedia({ bytes: JPG, mimeType: 'image/jpeg', prompt: 'x', meter }, cfg)).rejects.toMatchObject({ reason: 'no_provider' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('mock base URL is ignored in production', () => {
    expect(providerBases({ AI_PROVIDER_MOCK_URL: 'http://localhost:4600/', NODE_ENV: 'development' }).gemini).toBe('http://localhost:4600/gemini')
    expect(providerBases({ AI_PROVIDER_MOCK_URL: 'http://localhost:4600', NODE_ENV: 'production' }).gemini).toBe('https://generativelanguage.googleapis.com')
  })
})

describe('transcribeAudio', () => {
  it('Gemini: generateContent with inline_data (normalized ogg), key in header, audio tokens metered', async () => {
    const fetchMock = vi.fn().mockResolvedValue(geminiOk(' Hola, quiero reservar ', 1920))
    vi.stubGlobal('fetch', fetchMock)
    const cfg = buildAiConfig(null, { GEMINI_API_KEY: 'gkey' })
    const r = await transcribeAudio({ bytes: OGG, mimeType: 'audio/ogg; codecs=opus', language: 'es', meter }, cfg)
    expect(r).toEqual({ text: 'Hola, quiero reservar', provider: 'gemini', model: 'gemini-2.5-flash' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent')
    expect(url).not.toContain('key=')
    expect(init.headers['x-goog-api-key']).toBe('gkey')
    const body = JSON.parse(init.body)
    const parts = body.contents[0].parts
    expect(parts[0].text).toMatch(/Transcribe/)
    expect(parts[0].text).toMatch(/Spanish/)
    expect(parts[1].inline_data).toEqual({ mime_type: 'audio/ogg', data: Buffer.from(OGG).toString('base64') })
    expect(inserted[0]).toMatchObject({ purpose: 'transcription', provider: 'gemini', input_tokens: 100 })
    // audio tokens are capped to the prompt count: 100 at $1/M + 10 output at $2.5/M
    expect(Number(inserted[0].cost_usd)).toBeCloseTo((100 * 1 + 10 * 2.5) / 1e6, 10)
  })

  it('OpenAI: multipart /audio/transcriptions with file, model and language; falls back after Gemini fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"error":{"code":400}}', { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ text: 'Buenas tardes', usage: { type: 'duration', seconds: 30 } }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const cfg = buildAiConfig(null, { GEMINI_API_KEY: 'g', OPENAI_API_KEY: 'okey' })
    const r = await transcribeAudio({ bytes: OGG, mimeType: 'audio/ogg', language: 'es', meter }, cfg)
    expect(r.provider).toBe('openai')
    expect(r.text).toBe('Buenas tardes')
    const [url, init] = fetchMock.mock.calls[1]
    expect(url).toBe('https://api.openai.com/v1/audio/transcriptions')
    expect(init.headers.Authorization).toBe('Bearer okey')
    const form = init.body as FormData
    expect(form.get('model')).toBe('gpt-4o-mini-transcribe')
    expect(form.get('language')).toBe('es')
    const file = form.get('file') as File
    expect(file.name).toBe('audio.ogg')
    expect(file.size).toBe(OGG.byteLength)
    expect(inserted[0]).toMatchObject({ provider: 'openai', audio_seconds: 30 })
    expect(Number(inserted[0].cost_usd)).toBeCloseTo(0.0015, 8)
  })

  it('all providers failing → MediaAiUnavailableError(failed)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('boom', { status: 500 })))
    const cfg = buildAiConfig(null, { GEMINI_API_KEY: 'g' })
    await expect(transcribeAudio({ bytes: OGG, mimeType: 'audio/ogg', meter }, cfg)).rejects.toMatchObject({ reason: 'failed' })
  })

  it('rejects non-audio', async () => {
    const cfg = buildAiConfig(null, { GEMINI_API_KEY: 'g' })
    await expect(transcribeAudio({ bytes: JPG, mimeType: 'image/jpeg', meter }, cfg)).rejects.toMatchObject({ reason: 'unsupported_type' })
  })
})

describe('describeMedia', () => {
  it('OpenAI vision: image_url data URL; PDFs as a file part', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ choices: [{ message: { content: 'Un voucher' } }], usage: {} }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const cfg = buildAiConfig(null, { OPENAI_API_KEY: 'o' })
    await describeMedia({ bytes: JPG, mimeType: 'image/jpeg', prompt: 'describe', meter: { workspaceId: 'ws', purpose: 'vision' } }, cfg)
    let body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.openai.com/v1/chat/completions')
    expect(body.messages[0].content[1]).toEqual({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${Buffer.from(JPG).toString('base64')}` } })
    const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 1, 2, 3, 4, 5, 6, 7])
    await describeMedia({ bytes: PDF, mimeType: 'application/octet-stream', prompt: 'read', meter: { workspaceId: 'ws', purpose: 'vision' } }, cfg)
    body = JSON.parse(fetchMock.mock.calls[1][1].body)
    expect(body.messages[0].content[1].type).toBe('file')
    expect(body.messages[0].content[1].file.file_data).toMatch(/^data:application\/pdf;base64,/)
  })

  it('Gemini vision with inline_data for images', async () => {
    const fetchMock = vi.fn().mockResolvedValue(geminiOk('Una casa'))
    vi.stubGlobal('fetch', fetchMock)
    const r = await describeMedia({ bytes: JPG, mimeType: 'image/jpeg', prompt: 'p', meter }, buildAiConfig(null, { GEMINI_API_KEY: 'g' }))
    expect(r.text).toBe('Una casa')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).contents[0].parts[1].inline_data.mime_type).toBe('image/jpeg')
  })
})

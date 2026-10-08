import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: vi.fn() }))
vi.mock('./llm', async (orig) => ({ ...(await orig<typeof import('./llm')>()), completeJson: vi.fn() }))

import { completeJson, LlmUnavailableError } from './llm'
import { buildFollowupRequest, buildFollowupSystemPrompt, formatTranscript, generateFollowup, type FollowupPromptInput } from './followup'

const input = (over: Partial<FollowupPromptInput> = {}): FollowupPromptInput => ({
  workspaceId: 'ws1',
  businessName: 'Spa Luna',
  locale: 'es',
  agent: {
    id: 'ag1',
    name: 'Sofía',
    persona: 'cálida y cercana',
    tone: 'friendly',
    language: 'auto',
    instructions: 'Nunca ofrezcas descuentos.',
    model: 'gemini-2.5-flash',
  },
  channelType: 'whatsapp',
  channelId: 'ch1',
  conversationId: 'cv1',
  contactName: 'Ana',
  transcript: [
    { sender_type: 'customer', content_text: '¿Cuánto cuesta el masaje relajante?', content_type: 'text' },
    { sender_type: 'bot', content_text: 'Cuesta S/ 120 y dura 60 min. ¿Te reservo?', content_type: 'text' },
    { sender_type: 'agent', content_text: null, content_type: 'image' },
    { sender_type: 'bot', content_text: 'nota', content_type: 'system' },
  ],
  instructions: 'Menciona que hay cupos el sábado.',
  ...over,
})

beforeEach(() => {
  vi.mocked(completeJson).mockReset()
})

describe('buildFollowupSystemPrompt', () => {
  it('uses persona, tone, language rule and both instruction levels', () => {
    const p = buildFollowupSystemPrompt(input())
    expect(p).toContain('You are "Sofía", a virtual assistant of "Spa Luna"')
    expect(p).toContain('on WhatsApp')
    expect(p).toContain('Your personality: cálida y cercana')
    expect(p).toContain('Tone: warm, friendly and close.')
    expect(p).toContain('language the customer used (default Spanish)')
    expect(p).toContain('Customer name: Ana')
    expect(p).toContain('Nunca ofrezcas descuentos.')
    expect(p).toContain('INSTRUCTIONS FOR THIS FOLLOW-UP (priority):\nMenciona que hay cupos el sábado.')
    expect(p).not.toMatch(/\n\n\n/)
  })

  it('fixed language and optional parts omitted', () => {
    const p = buildFollowupSystemPrompt(
      input({ agent: { ...input().agent, language: 'en', persona: null, instructions: null }, contactName: null, instructions: null }),
    )
    expect(p).toContain('Write in English.')
    expect(p).not.toContain('personality')
    expect(p).not.toContain('Customer name')
    expect(p).not.toContain('INSTRUCTIONS FOR THIS FOLLOW-UP')
  })
})

describe('transcript + request', () => {
  it('formats oldest first, labels sides, skips system rows', () => {
    expect(formatTranscript(input().transcript, 'Spa Luna')).toBe(
      'Customer: ¿Cuánto cuesta el masaje relajante?\nSpa Luna: Cuesta S/ 120 y dura 60 min. ¿Te reservo?\nSpa Luna: [image]',
    )
  })

  it('one user turn, JSON schema, agent model and usage meter', () => {
    const req = buildFollowupRequest(input())
    expect(req.turns).toHaveLength(1)
    expect(req.turns[0].role).toBe('user')
    expect(req.turns[0].content).toContain('Customer: ¿Cuánto cuesta')
    expect(req.schema).toMatchObject({ required: ['message'] })
    expect(req.model).toBe('gemini-2.5-flash')
    expect(req.meter).toEqual({ workspaceId: 'ws1', purpose: 'followup', aiAgentId: 'ag1', conversationId: 'cv1', channelId: 'ch1' })
  })
})

describe('generateFollowup', () => {
  it('returns the trimmed message', async () => {
    vi.mocked(completeJson).mockResolvedValue('{"message":"  Hola Ana, ¿te reservo el sábado?  "}')
    await expect(generateFollowup(input())).resolves.toBe('Hola Ana, ¿te reservo el sábado?')
    expect(completeJson).toHaveBeenCalledWith(expect.objectContaining({ meter: expect.objectContaining({ purpose: 'followup' }) }))
  })

  it('caps very long messages', async () => {
    vi.mocked(completeJson).mockResolvedValue(JSON.stringify({ message: 'a'.repeat(900) }))
    const out = await generateFollowup(input())
    expect(out.length).toBe(600)
    expect(out.endsWith('…')).toBe(true)
  })

  it('fails on empty output', async () => {
    vi.mocked(completeJson).mockResolvedValue('{"message":""}')
    await expect(generateFollowup(input())).rejects.toThrow('La IA no devolvió')
  })

  it('propagates LlmUnavailableError', async () => {
    vi.mocked(completeJson).mockRejectedValue(new LlmUnavailableError('No AI provider configured'))
    await expect(generateFollowup(input())).rejects.toBeInstanceOf(LlmUnavailableError)
  })
})

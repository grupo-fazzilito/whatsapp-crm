import { describe, expect, it } from 'vitest'
import {
  aiAssistSettings,
  buildTranscript,
  classifyMediaUrl,
  messageTextForAi,
  normalizeSummary,
  parseAiAssistPatch,
  parseStoredSummary,
  summaryPrompt,
  suggestPrompt,
  type TranscriptMessage,
} from './core'
import { audioFileName, mediaKindOf, normalizeMime, resolveMime, sniffMime } from './mime'
import { costUsd, priceFor } from '../pricing'

describe('classifyMediaUrl', () => {
  it('recognises our proxies, signed attachments and https', () => {
    expect(classifyMediaUrl('/api/media/0b1c-22/wamid.ABC_1')).toEqual({ kind: 'wa_proxy', channelId: '0b1c-22', mediaId: 'wamid.ABC_1' })
    expect(classifyMediaUrl('/api/whatsapp/media/123')).toEqual({ kind: 'wa_legacy', mediaId: '123' })
    expect(classifyMediaUrl('http://127.0.0.1:54321/storage/v1/object/sign/attachments/ws1/webchat/c1/a.jpg?token=x')).toEqual({
      kind: 'attachment',
      path: 'ws1/webchat/c1/a.jpg',
    })
    expect(classifyMediaUrl('https://app.example.com/api/files/attachments/ws1/webchat/c1/a.jpg?exp=1&sig=x')).toEqual({
      kind: 'attachment',
      path: 'ws1/webchat/c1/a.jpg',
    })
    expect(classifyMediaUrl('/api/files/attachments/ws1/inbox/a%20b.pdf?exp=1&sig=x')).toEqual({ kind: 'attachment', path: 'ws1/inbox/a b.pdf' })
    expect(classifyMediaUrl('https://scontent.xx.fbcdn.net/v/a.jpg')).toEqual({ kind: 'external', url: 'https://scontent.xx.fbcdn.net/v/a.jpg' })
  })
  it('rejects anything else', () => {
    expect(classifyMediaUrl('http://169.254.169.254/latest')).toBeNull()
    expect(classifyMediaUrl('file:///etc/passwd')).toBeNull()
    expect(classifyMediaUrl('https://x/storage/v1/object/sign/attachments/../etc?x')).toBeNull()
    expect(classifyMediaUrl('/api/files/attachments/ws1/%2e%2e/x')).toBeNull()
    expect(classifyMediaUrl(null)).toBeNull()
  })
})

describe('settings', () => {
  it('defaults: transcribe on, images off', () => {
    expect(aiAssistSettings({})).toEqual({ auto_transcribe: true, auto_read_images: false })
    expect(aiAssistSettings({ ai_assist: { auto_transcribe: false, auto_read_images: true } })).toEqual({ auto_transcribe: false, auto_read_images: true })
  })
  it('patch validation', () => {
    expect(parseAiAssistPatch({ auto_transcribe: false })).toEqual({ auto_transcribe: false })
    expect(parseAiAssistPatch({ auto_transcribe: 'no' })).toBeNull()
    expect(parseAiAssistPatch({})).toBeNull()
  })
})

describe('messageTextForAi', () => {
  it('voice notes read as transcript, images as [Imagen: …]', () => {
    expect(messageTextForAi({ content_type: 'audio', transcript: ' Hola, quiero 2 pizzas ' })).toBe('Hola, quiero 2 pizzas')
    expect(messageTextForAi({ content_type: 'audio' })).toBe('[Audio]')
    expect(messageTextForAi({ content_type: 'image', content_text: 'este', ai_media_text: 'Voucher Yape S/ 35' })).toBe('[Imagen: Voucher Yape S/ 35]\neste')
    expect(messageTextForAi({ content_type: 'image', ai_media_text: 'A red dress' }, 'en')).toBe('[Image: A red dress]')
    expect(messageTextForAi({ content_type: 'video' })).toBe('[Video]')
  })
})

describe('summary / suggest prompts', () => {
  const msgs: TranscriptMessage[] = [
    { sender_type: 'customer', content_type: 'text', content_text: 'Hola, precio del depa?', created_at: '2026-10-01T10:00:00Z' },
    { sender_type: 'agent', sender_name: 'Ana', content_type: 'text', content_text: 'NOTA SECRETA: cliente moroso', is_internal: true, created_at: '2026-10-01T10:01:00Z' },
    { sender_type: 'agent', content_type: 'system', content_text: 'asignado', created_at: '2026-10-01T10:01:30Z' },
    { sender_type: 'customer', content_type: 'audio', transcript: 'Lo quiero ver el sábado', created_at: '2026-10-01T10:02:00Z' },
    { sender_type: 'agent', sender_name: 'Ana', content_type: 'text', content_text: 'Claro', created_at: '2026-10-01T10:03:00Z' },
  ]
  it('excludes internal notes and system rows; uses transcripts', () => {
    const tr = buildTranscript(msgs, 'es')
    expect(tr).not.toContain('SECRETA')
    expect(tr).not.toContain('asignado')
    expect(tr).toContain('Cliente: Lo quiero ver el sábado')
    expect(tr).toContain('Asesor (Ana): Claro')
    const p = summaryPrompt({ businessName: 'Inmo', locale: 'es', transcript: tr })
    expect(p.system).toContain('Spanish')
    expect(p.user).not.toContain('SECRETA')
  })
  it('keeps the most recent lines within the budget', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ sender_type: 'customer', content_type: 'text', content_text: `m${i} ${'x'.repeat(50)}`, created_at: '2026-10-01T10:00:00Z' }))
    const tr = buildTranscript(many, 'es', 500)
    expect(tr).toContain('m49')
    expect(tr).not.toContain('m0 ')
  })
  it('suggest prompt carries persona and hint', () => {
    const p = suggestPrompt({ businessBlock: '- Name: Inmo', persona: { name: 'Sofía', tone: 'formal', language: 'es' }, locale: 'es', transcript: 'x', hint: 'más corto' })
    expect(p.system).toContain('"Sofía"')
    expect(p.system).toContain('Write in Spanish')
    expect(p.user).toContain('más corto')
    expect(suggestPrompt({ businessBlock: '', persona: null, locale: 'en', transcript: '' }).system).toContain('helpful')
  })
  it('normalizes and parses summaries', () => {
    const s = normalizeSummary({ key_points: ['a', 3, ''], customer_intent: 'comprar', pending: [], next_step: 'llamar' })
    expect(s).toEqual({ key_points: ['a'], customer_intent: 'comprar', pending: [], next_step: 'llamar' })
    expect(parseStoredSummary(JSON.stringify(s))).toEqual(s)
    expect(parseStoredSummary('texto plano')?.key_points).toEqual(['texto plano'])
    expect(normalizeSummary({})).toBeNull()
  })
})

describe('mime helpers', () => {
  it('normalizes WhatsApp voice-note types and sniffs bytes', () => {
    expect(normalizeMime('audio/ogg; codecs=opus')).toBe('audio/ogg')
    expect(mediaKindOf('audio/ogg; codecs=opus')).toBe('audio')
    expect(mediaKindOf('application/pdf')).toBe('pdf')
    expect(mediaKindOf('image/jpeg')).toBe('image')
    expect(mediaKindOf('video/mp4')).toBeNull()
    const ogg = new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0, 0, 0, 0, 0, 0, 0, 0])
    expect(sniffMime(ogg)).toBe('audio/ogg')
    expect(resolveMime('application/octet-stream', ogg)).toBe('audio/ogg')
    expect(resolveMime('image/png', ogg)).toBe('image/png')
    expect(audioFileName('audio/ogg; codecs=opus')).toBe('audio.ogg')
    expect(audioFileName('audio/mpeg')).toBe('audio.mp3')
  })
})

describe('audio pricing', () => {
  it('Gemini audio tokens at $1/M on 2.5 Flash', () => {
    const p = priceFor('gemini', 'gemini-2.5-flash')
    expect(costUsd({ input: 1_000_000, cachedInput: 0, output: 0, audioInput: 1_000_000 }, p)).toBeCloseTo(1)
    expect(costUsd({ input: 1_000_000, cachedInput: 0, output: 0, audioInput: 500_000 }, p)).toBeCloseTo(0.65)
  })
  it('per-minute billing for duration-billed transcription', () => {
    expect(costUsd({ input: 0, cachedInput: 0, output: 0, audioSeconds: 120 }, priceFor('openai', 'whisper-1'))).toBeCloseTo(0.012)
  })
})

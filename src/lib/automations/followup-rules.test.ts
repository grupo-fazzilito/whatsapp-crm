import { describe, expect, it } from 'vitest'
import {
  channelMatches,
  delayHours,
  delayMs,
  handlerMatches,
  isAiHandled,
  normalizeNoReplyConfig,
  outboundArmsFollowups,
  scheduleRow,
  supportsTemplates,
  windowClosedMessage,
  windowState,
} from './followup-rules'

const NOW = new Date('2026-10-07T12:00:00.000Z')
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString()

describe('delays', () => {
  it('converts amount + unit', () => {
    expect(delayMs({ amount: 2, unit: 'hours' })).toBe(7_200_000)
    expect(delayMs({ amount: 30, unit: 'minutes' })).toBe(1_800_000)
    expect(delayHours({ amount: 3, unit: 'days' })).toBe(72)
  })
  it('treats missing / invalid amounts as 0', () => {
    expect(delayMs({ amount: 0, unit: 'hours' })).toBe(0)
    expect(delayMs({ amount: 'x', unit: 'hours' })).toBe(0)
    expect(delayMs(null)).toBe(0)
  })
})

describe('normalizeNoReplyConfig', () => {
  it('fills defaults and drops junk', () => {
    expect(normalizeNoReplyConfig({ after: { amount: '5', unit: 'weeks' }, channel_ids: ['a', '', 3] })).toEqual({
      after: { amount: 5, unit: 'hours' },
      channel_ids: ['a'],
      only_when_ai: false,
      only_when_human: false,
    })
    expect(normalizeNoReplyConfig(undefined).after).toEqual({ amount: 0, unit: 'hours' })
  })
})

describe('filters', () => {
  it('channel filter: empty = all', () => {
    const all = normalizeNoReplyConfig({ after: { amount: 1, unit: 'hours' } })
    const some = normalizeNoReplyConfig({ after: { amount: 1, unit: 'hours' }, channel_ids: ['ch1'] })
    expect(channelMatches(all, 'anything')).toBe(true)
    expect(channelMatches(all, null)).toBe(true)
    expect(channelMatches(some, 'ch1')).toBe(true)
    expect(channelMatches(some, 'ch2')).toBe(false)
    expect(channelMatches(some, null)).toBe(false)
  })

  it('AI-handled = an agent owns it and the AI is not paused', () => {
    expect(isAiHandled({ conversationAgentId: 'a', now: NOW })).toBe(true)
    expect(isAiHandled({ channelAgentId: 'a', now: NOW })).toBe(true)
    expect(isAiHandled({ now: NOW })).toBe(false)
    expect(isAiHandled({ channelAgentId: 'a', aiPausedUntil: new Date(NOW.getTime() + 1000).toISOString(), now: NOW })).toBe(false)
    expect(isAiHandled({ channelAgentId: 'a', aiPausedUntil: hoursAgo(1), now: NOW })).toBe(true)
  })

  it('only_when_ai / only_when_human', () => {
    const ai = normalizeNoReplyConfig({ after: { amount: 1, unit: 'hours' }, only_when_ai: true })
    const human = normalizeNoReplyConfig({ after: { amount: 1, unit: 'hours' }, only_when_human: true })
    const any = normalizeNoReplyConfig({ after: { amount: 1, unit: 'hours' } })
    expect(handlerMatches(ai, true)).toBe(true)
    expect(handlerMatches(ai, false)).toBe(false)
    expect(handlerMatches(human, true)).toBe(false)
    expect(handlerMatches(human, false)).toBe(true)
    expect(handlerMatches(any, true) && handlerMatches(any, false)).toBe(true)
  })
})

describe('outboundArmsFollowups', () => {
  it('arms on agent/bot/automation sends that did not fail', () => {
    expect(outboundArmsFollowups({ status: 'sent' })).toBe(true)
    expect(outboundArmsFollowups({ status: 'delivered', metadata: { source: 'automation' } })).toBe(true)
  })
  it('never arms on failures, follow-ups or broadcasts', () => {
    expect(outboundArmsFollowups({ status: 'failed' })).toBe(false)
    expect(outboundArmsFollowups({ status: 'sent', metadata: { source: 'automation', followup: true } })).toBe(false)
    expect(outboundArmsFollowups({ status: 'sent', metadata: { source: 'broadcast' } })).toBe(false)
  })
})

describe('scheduleRow', () => {
  it('re-anchors at now + after, resetting status', () => {
    const row = scheduleRow({
      workspaceId: 'ws',
      automationId: 'au',
      conversationId: 'cv',
      contactId: 'ct',
      anchorMessageId: 'msg',
      after: { amount: 2, unit: 'hours' },
      now: NOW,
    })
    expect(row).toMatchObject({
      workspace_id: 'ws',
      automation_id: 'au',
      conversation_id: 'cv',
      anchor_message_id: 'msg',
      anchored_at: NOW.toISOString(),
      due_at: '2026-10-07T14:00:00.000Z',
      status: 'pending',
      fired_at: null,
      cancelled_at: null,
    })
  })
  it('never schedules sooner than one minute', () => {
    const row = scheduleRow({
      workspaceId: 'ws', automationId: 'au', conversationId: 'cv', contactId: null, anchorMessageId: null,
      after: { amount: 0, unit: 'minutes' }, now: NOW,
    })
    expect(row.due_at).toBe('2026-10-07T12:01:00.000Z')
  })
})

describe('windowState', () => {
  it('WhatsApp / IG / Messenger: open < 24 h after the customer last wrote', () => {
    for (const type of ['whatsapp', 'instagram', 'messenger'] as const) {
      expect(windowState(type, hoursAgo(23.9), NOW)).toEqual({ open: true, hours: 24 })
      expect(windowState(type, hoursAgo(24), NOW)).toEqual({ open: false, hours: 24 })
    }
  })
  it('closed when the customer never wrote', () => {
    expect(windowState('whatsapp', null, NOW).open).toBe(false)
  })
  it('TikTok 48 h; web chat has no window; null type = WhatsApp', () => {
    expect(windowState('tiktok', hoursAgo(30), NOW)).toEqual({ open: true, hours: 48 })
    expect(windowState('webchat', null, NOW)).toEqual({ open: true, hours: null })
    expect(windowState(null, hoursAgo(25), NOW)).toEqual({ open: false, hours: 24 })
  })
  it('clear failure message', () => {
    expect(windowClosedMessage(24)).toBe('Ventana de 24 h cerrada: usa una plantilla')
  })
  it('templates only on WhatsApp', () => {
    expect(supportsTemplates('whatsapp')).toBe(true)
    expect(supportsTemplates('instagram')).toBe(false)
    expect(supportsTemplates('webchat')).toBe(false)
  })
})

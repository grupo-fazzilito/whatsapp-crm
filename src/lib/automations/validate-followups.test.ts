import { describe, expect, it } from 'vitest'
import {
  partitionIssues,
  validateChannelRules,
  validateStepsForActivation,
  validateTriggerForActivation,
  type ChannelRef,
} from './validate'

const WA: ChannelRef = { id: 'wa', type: 'whatsapp' }
const IG: ChannelRef = { id: 'ig', type: 'instagram' }
const WEB: ChannelRef = { id: 'web', type: 'webchat' }
const msg = { step_type: 'send_message', step_config: { text: 'hola' } }
const ai = { step_type: 'ai_followup', step_config: {} }
const tpl = { step_type: 'send_template', step_config: { template_name: 'recuperar' } }
const wait = (amount: number, unit: string) => ({ step_type: 'wait', step_config: { amount, unit } })
const noReply = (amount: number, unit: string, extra: Record<string, unknown> = {}) => ({
  after: { amount, unit },
  ...extra,
})

describe('no_reply trigger config', () => {
  it('accepts a valid config', () => {
    expect(validateTriggerForActivation('no_reply', noReply(2, 'hours'))).toEqual([])
  })
  it('rejects bad delay, unit, both filters and > 30 days', () => {
    const codes = (cfg: unknown) => validateTriggerForActivation('no_reply', cfg).map((i) => i.code)
    expect(codes({})).toEqual(['no_reply_amount', 'no_reply_unit'])
    expect(codes(noReply(0, 'hours'))).toEqual(['no_reply_amount'])
    expect(codes(noReply(31, 'days'))).toEqual(['no_reply_too_long'])
    expect(codes(noReply(1, 'hours', { only_when_ai: true, only_when_human: true }))).toEqual(['no_reply_both_filters'])
    expect(codes(noReply(1, 'hours', { channel_ids: 'wa' }))).toEqual(['no_reply_channels'])
  })
})

describe('ai_followup step', () => {
  it('needs no config', () => {
    expect(validateStepsForActivation([ai])).toEqual([])
  })
  it('limits instructions', () => {
    const issues = validateStepsForActivation([{ step_type: 'ai_followup', step_config: { instructions: 'x'.repeat(1001) } }])
    expect(issues.map((i) => i.code)).toEqual(['ai_followup_instructions_long'])
  })
})

describe('validateChannelRules — 24 h window', () => {
  it('no_reply 2 h → send_message is fine', () => {
    expect(validateChannelRules({ triggerType: 'no_reply', triggerConfig: noReply(2, 'hours'), steps: [msg], channels: [WA] })).toEqual([])
  })

  it('no_reply 23 h (last call) → ai_followup is fine', () => {
    expect(validateChannelRules({ triggerType: 'no_reply', triggerConfig: noReply(23, 'hours'), steps: [ai], channels: [WA, IG] })).toEqual([])
  })

  it('no_reply ≥ 24 h → free-form send is an error on WhatsApp/IG/Messenger', () => {
    const issues = validateChannelRules({ triggerType: 'no_reply', triggerConfig: noReply(1, 'days'), steps: [msg, ai], channels: [WA, IG] })
    expect(issues.map((i) => [i.path, i.code, i.severity])).toEqual([
      ['steps[0]', 'window_closed', 'error'],
      ['steps[1]', 'window_closed', 'error'],
    ])
    expect(issues[0].params).toMatchObject({ hours: 24, channels: 'WhatsApp, Instagram' })
  })

  it('waits before the send add up (20 h + wait 5 h)', () => {
    const issues = validateChannelRules({ triggerType: 'no_reply', triggerConfig: noReply(20, 'hours'), steps: [msg, wait(5, 'hours'), msg], channels: [WA] })
    expect(issues.map((i) => i.path)).toEqual(['steps[2]'])
  })

  it('applies to any trigger when waits push past 24 h', () => {
    const issues = validateChannelRules({ triggerType: 'new_message_received', triggerConfig: {}, steps: [wait(2, 'days'), msg], channels: [WA] })
    expect(issues.map((i) => i.code)).toEqual(['window_closed'])
  })

  it('a wait inside a branch only delays that branch', () => {
    const cond = {
      step_type: 'condition',
      step_config: { subject: 'tag_presence', operand: 't' },
      branches: { yes: [wait(2, 'days'), msg], no: [msg] },
    }
    const issues = validateChannelRules({ triggerType: 'keyword_match', triggerConfig: {}, steps: [cond, msg], channels: [WA] })
    expect(issues.map((i) => i.path)).toEqual(['steps[0].yes.steps[1]'])
  })

  it('mixed channels (web chat has no window) → warning only', () => {
    const issues = validateChannelRules({ triggerType: 'no_reply', triggerConfig: noReply(3, 'days'), steps: [msg], channels: [WA, WEB] })
    expect(issues.map((i) => [i.code, i.severity])).toEqual([['window_closed_some', 'warning']])
    expect(partitionIssues(issues).errors).toEqual([])
  })

  it('channel filter narrows the targeted channels', () => {
    const issues = validateChannelRules({
      triggerType: 'no_reply',
      triggerConfig: noReply(3, 'days', { channel_ids: ['web'] }),
      steps: [msg],
      channels: [WA, WEB],
    })
    expect(issues).toEqual([])
  })

  it('no channels yet → warning when past 24 h', () => {
    const issues = validateChannelRules({ triggerType: 'no_reply', triggerConfig: noReply(3, 'days'), steps: [msg], channels: [] })
    expect(issues.map((i) => i.severity)).toEqual(['warning'])
  })
})

describe('validateChannelRules — templates', () => {
  it('3-day win-back with a template on WhatsApp is valid', () => {
    expect(validateChannelRules({ triggerType: 'no_reply', triggerConfig: noReply(3, 'days'), steps: [tpl], channels: [WA] })).toEqual([])
  })
  it('templates only on WhatsApp: error when no targeted channel supports them', () => {
    const issues = validateChannelRules({ triggerType: 'no_reply', triggerConfig: noReply(3, 'days'), steps: [tpl], channels: [IG, WEB] })
    expect(issues.map((i) => [i.code, i.severity])).toEqual([['template_whatsapp_only', 'error']])
  })
  it('warning when only some targeted channels support them', () => {
    const issues = validateChannelRules({ triggerType: 'no_reply', triggerConfig: noReply(3, 'days'), steps: [tpl], channels: [WA, IG] })
    expect(issues.map((i) => [i.code, i.severity])).toEqual([['template_some_channels', 'warning']])
  })
})

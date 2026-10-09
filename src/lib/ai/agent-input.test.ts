import { describe, expect, it } from 'vitest'
import { parseAgentInput } from './agent-input'

const ID = '0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d'

describe('parseAgentInput', () => {
  it('requires a name on create and trims/blanks text fields', () => {
    expect(parseAgentInput({}, false)).toEqual({ ok: false, error: 'name is required' })
    expect(parseAgentInput({ name: '  Ana ', persona: '  ', instructions: ' be nice ', language: 'es' }, false)).toEqual({
      ok: true,
      value: { name: 'Ana', persona: null, instructions: 'be nice', language: 'es' },
    })
  })
  it('patch: only the given fields, validated', () => {
    expect(parseAgentInput({ enabled: false }, true)).toEqual({ ok: true, value: { enabled: false } })
    expect(parseAgentInput({ enabled: 'no' }, true).ok).toBe(false)
    expect(parseAgentInput({ language: 'fr' }, true).ok).toBe(false)
    expect(parseAgentInput({ skills: ['faq', 'faq', ' handover '] }, true)).toEqual({ ok: true, value: { skills: ['faq', 'handover'] } })
    expect(parseAgentInput({ transfer_agent_ids: ['nope'] }, true).ok).toBe(false)
    expect(parseAgentInput({ transfer_agent_ids: [ID, ID] }, true)).toEqual({ ok: true, value: { transfer_agent_ids: [ID] } })
    expect(parseAgentInput({ model: '' }, true)).toEqual({ ok: true, value: { model: null } })
    expect(parseAgentInput({ workspace_id: ID, id: ID }, true)).toEqual({ ok: true, value: {} })
  })
})

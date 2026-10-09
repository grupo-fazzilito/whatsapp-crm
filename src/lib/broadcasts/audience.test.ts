import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const { parseAudience, parseRecipientUpdates } = await import('./audience')

const ID = '0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d'

describe('parseAudience', () => {
  it('accepts the wizard shapes', () => {
    expect(parseAudience({ type: 'all' })).toEqual({ ok: true, value: { type: 'all', tagIds: [], excludeTagIds: [] } })
    expect(parseAudience({ type: 'tags', tagIds: [ID, ID], excludeTagIds: [ID] })).toEqual({
      ok: true,
      value: { type: 'tags', tagIds: [ID], excludeTagIds: [ID] },
    })
    const cf = parseAudience({ type: 'custom_field', customField: { fieldId: ID, operator: 'contains', value: 'x' } })
    expect(cf.ok && cf.value.customField).toEqual({ fieldId: ID, operator: 'contains', value: 'x' })
    const csv = parseAudience({ type: 'csv', csvContacts: [{ phone: '+1', name: 'A' }] })
    expect(csv.ok && csv.value.csvContacts).toEqual([{ phone: '+1', name: 'A' }])
  })
  it('rejects bad input', () => {
    expect(parseAudience(null).ok).toBe(false)
    expect(parseAudience({ type: 'everyone' }).ok).toBe(false)
    expect(parseAudience({ type: 'tags', tagIds: ['x'] }).ok).toBe(false)
    expect(parseAudience({ type: 'custom_field', customField: { fieldId: '', operator: 'is', value: '' } }).ok).toBe(false)
    expect(parseAudience({ type: 'csv', csvContacts: [{ name: 'no phone' }] }).ok).toBe(false)
  })
})

describe('parseRecipientUpdates', () => {
  it('validates ids and statuses', () => {
    expect(parseRecipientUpdates(undefined)).toEqual([])
    expect(parseRecipientUpdates([{ id: ID, status: 'sent', whatsapp_message_id: 'w' }])).toEqual([
      { id: ID, status: 'sent', whatsapp_message_id: 'w', error_message: null },
    ])
    expect(parseRecipientUpdates([{ id: ID, status: 'delivered' }])).toBeNull()
    expect(parseRecipientUpdates([{ id: 'x', status: 'sent' }])).toBeNull()
  })
})

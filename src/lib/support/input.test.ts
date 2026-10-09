import { describe, expect, it } from 'vitest'
import { parseAttachments, parseNewTicket } from './input'

const WS = '11111111-1111-1111-1111-111111111111'

describe('support ticket input', () => {
  it('validates subject and body, defaults category and priority', () => {
    expect(parseNewTicket({ subject: 'No llegan mensajes', body: 'Desde ayer' }, WS)).toEqual({
      ok: true,
      value: { subject: 'No llegan mensajes', category: 'other', priority: 'normal', body: 'Desde ayer', attachments: [] },
    })
    expect(parseNewTicket({ subject: 'ab', body: 'x' }, WS)).toEqual({ ok: false, error: 'invalid_subject' })
    expect(parseNewTicket({ subject: 'Asunto ok', body: '   ' }, WS)).toEqual({ ok: false, error: 'invalid_body' })
    expect(parseNewTicket({ subject: 'Asunto ok', body: 'x', category: 'billing', priority: 'high' }, WS)).toMatchObject({ value: { category: 'billing', priority: 'high' } })
  })
  it('attachments must live in the business folder', () => {
    expect(parseAttachments([{ path: `${WS}/support/a.png`, name: 'a.png', type: 'image/png' }], WS)).toHaveLength(1)
    expect(parseAttachments([{ path: 'otro/support/a.png' }], WS)).toBe('invalid attachment')
    expect(parseAttachments([{ path: `${WS}/../x` }], WS)).toBe('invalid attachment')
  })
})

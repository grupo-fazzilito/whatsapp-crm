import { describe, expect, it } from 'vitest'
import { complaintCode, parseComplaint, peruHolidays, responseDueDate } from './input'

const valid = {
  kind: 'reclamo', consumer_name: ' Ana  Pérez ', doc_type: 'dni', doc_number: '12345678', address: 'Av. Real 123, Huancayo', phone: '+51 999 888 777',
  email: 'Ana@Mail.com ', item_type: 'servicio', item_description: 'Recarga de tokens', amount: '50,5', detail: 'Pagué y no recibí los tokens.', request: 'Que acrediten los tokens.', accepted: true,
}

describe('parseComplaint', () => {
  it('accepts and normalizes a complete form', () => {
    const r = parseComplaint(valid)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toMatchObject({ consumer_name: 'Ana Pérez', email: 'ana@mail.com', amount: 50.5, is_minor: false, guardian_name: null })
  })

  it('checks the ID by type', () => {
    expect(parseComplaint({ ...valid, doc_number: '1234567' })).toMatchObject({ ok: false, errors: { doc_number: 'doc_dni' } })
    expect(parseComplaint({ ...valid, doc_type: 'ruc', doc_number: '20616065484' }).ok).toBe(true)
    expect(parseComplaint({ ...valid, doc_type: 'ruc', doc_number: '99616065484' })).toMatchObject({ ok: false, errors: { doc_number: 'doc_ruc' } })
  })

  it('requires a guardian for minors, consent, and the core fields', () => {
    expect(parseComplaint({ ...valid, is_minor: true })).toMatchObject({ ok: false, errors: { guardian_name: 'guardian' } })
    expect(parseComplaint({ ...valid, accepted: false })).toMatchObject({ ok: false, errors: { accepted: 'accepted' } })
    const r = parseComplaint({ accepted: true })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(['address', 'consumer_name', 'detail', 'doc_type', 'email', 'item_description', 'item_type', 'kind', 'request'])
  })

  it('treats an empty amount as none and rejects bad ones', () => {
    expect(parseComplaint({ ...valid, amount: '' })).toMatchObject({ ok: true, value: { amount: null } })
    expect(parseComplaint({ ...valid, amount: '-3' })).toMatchObject({ ok: false, errors: { amount: 'amount' } })
  })
})

describe('numbering and deadline', () => {
  it('formats the correlative number', () => {
    expect(complaintCode(42, 2026)).toBe('000042-2026')
  })

  it('knows Peru holidays including Holy Thursday and Friday', () => {
    const h = peruHolidays(2026) // Easter Sunday 2026-04-05
    expect(h.has('04-02')).toBe(true)
    expect(h.has('04-03')).toBe(true)
    expect(h.has('07-28')).toBe(true)
  })

  it('counts 15 business days in Lima time, skipping weekends and holidays', () => {
    // Wed 2026-10-14 10:00 Lima → Oct 15,16,19-23,26-30 (12), Nov 2,3,4 (Nov 1 is Sunday) → Nov 4
    expect(responseDueDate(new Date('2026-10-14T15:00:00Z'))).toBe('2026-11-04')
    // Filed at 23:30 Lima on Oct 14 is still Oct 14 there (04:30 UTC on the 15th).
    expect(responseDueDate(new Date('2026-10-15T04:30:00Z'))).toBe('2026-11-04')
    // Skips Dec 8, 9 and 25: filed Mon 2026-12-07 → Dec 10,11,14-18,21-24,28-31 (15) → Dec 31
    expect(responseDueDate(new Date('2026-12-07T15:00:00Z'))).toBe('2026-12-31')
  })
})

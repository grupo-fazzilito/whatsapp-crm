import { describe, expect, it } from 'vitest'
import { isDay, nextDay, parseBackupParams } from './params'

const parse = (q: string) => parseBackupParams(new URLSearchParams(q))

describe('backup params', () => {
  it('defaults to every dataset', () => {
    expect(parse('')).toEqual({ ok: true, params: { datasets: ['conversations', 'contacts', 'products', 'automations', 'templates'], from: null, to: null, includeInternal: false, lang: null } })
  })
  it('reads every option', () => {
    expect(parse('datasets=contacts,conversations&from=2026-11-01&to=2026-11-26&internal=1&lang=en')).toEqual({
      ok: true,
      params: { datasets: ['conversations', 'contacts'], from: '2026-11-01', to: '2026-11-26', includeInternal: true, lang: 'en' },
    })
  })
  it.each([
    ['datasets=', 'invalid_datasets'],
    ['datasets=contacts,secrets', 'invalid_datasets'],
    ['from=2026-02-31', 'invalid_dates'],
    ['from=2026-11-05&to=2026-11-01', 'invalid_dates'],
    ['from=yesterday', 'invalid_dates'],
    ['internal=yes', 'invalid_params'],
    ['lang=fr', 'invalid_params'],
    ['workspace=abc', 'invalid_params'],
    ['lang=es&lang=en', 'invalid_params'],
  ])('rejects %s', (q, error) => {
    expect(parse(q)).toEqual({ ok: false, error })
  })
  it('days', () => {
    expect(isDay('2028-02-29')).toBe(true)
    expect(isDay('2026-02-29')).toBe(false)
    expect(nextDay('2026-12-31')).toBe('2027-01-01')
  })
})

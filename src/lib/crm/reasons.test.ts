import { describe, expect, it } from 'vitest'
import { DEFAULT_LOST_REASONS, MAX_LOST_REASONS, isOtherReason, lostReasons, normalizeReasons } from './reasons'

describe('lostReasons', () => {
  it('falls back to localized defaults', () => {
    expect(lostReasons(null)).toEqual(DEFAULT_LOST_REASONS.es)
    expect(lostReasons({}, 'en')).toEqual(DEFAULT_LOST_REASONS.en)
    expect(lostReasons({ crm: { lost_reasons: [] } })).toEqual(DEFAULT_LOST_REASONS.es)
    expect(lostReasons({ crm: { lost_reasons: 'Precio' } })).toEqual(DEFAULT_LOST_REASONS.es)
    expect(DEFAULT_LOST_REASONS.es).toEqual(['Precio', 'Eligió a la competencia', 'Sin respuesta', 'No era el momento', 'Otro'])
  })
  it('uses the workspace list when set', () => {
    expect(lostReasons({ crm: { lost_reasons: ['Caro', ' Sin stock '] } }, 'en')).toEqual(['Caro', 'Sin stock'])
  })
})

describe('normalizeReasons', () => {
  it('trims, dedupes case-insensitively, drops junk and caps', () => {
    expect(normalizeReasons(['  Precio ', 'precio', '', 3, null, 'Sin   respuesta'])).toEqual(['Precio', 'Sin respuesta'])
    expect(normalizeReasons(Array.from({ length: 40 }, (_, i) => `R${i}`))).toHaveLength(MAX_LOST_REASONS)
    expect(normalizeReasons(['x'.repeat(200)])[0]).toHaveLength(80)
    expect(normalizeReasons(undefined)).toEqual([])
  })
})

describe('isOtherReason', () => {
  it('detects the catch-all option', () => {
    expect(isOtherReason('Otro')).toBe(true)
    expect(isOtherReason(' other ')).toBe(true)
    expect(isOtherReason('Otros')).toBe(true)
    expect(isOtherReason('Precio')).toBe(false)
  })
})
